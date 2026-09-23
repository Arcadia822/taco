import { readFile } from "node:fs/promises";
const SAFE_PATH_PATTERN = /^(?![a-zA-Z]:)(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+(?:\/(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+)*$/;
const SAFE_ROOT_PATTERN = /^(?:\.|(?![a-zA-Z]:)(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+(?:\/(?!(?:\.{1,2}(?:\/|$)))[^/\\\0]+)*)$/;
const isSafePath = (path) => typeof path === "string" && path.length > 0 && SAFE_PATH_PATTERN.test(path);
const isSafeRootPath = (root) => typeof root === "string" && root.length > 0 && SAFE_ROOT_PATTERN.test(root);
const isStatus = (value) => value === "todo" || value === "in_progress" || value === "complete" || value === "freeze";
const isUtcTimestamp = (value) => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]) && date.getUTCHours() === Number(match[4]) && date.getUTCMinutes() === Number(match[5]) && date.getUTCSeconds() === Number(match[6]);
};
const inRoot = (path, root) => isSafePath(path) && (root === "." || path.startsWith(`${root}/`));
const fail = (path, err) => ({
  ok: false,
  err,
  path
});
const layoutNodes = (nodes) => {
  const pending = /* @__PURE__ */ new Map();
  const successors = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    pending.set(node.id, node.after.length);
    successors.set(node.id, []);
  }
  for (const node of nodes) {
    for (const predecessor of node.after) successors.get(predecessor)?.push(node.id);
  }
  let ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const levels = [];
  let visited = 0;
  while (ready.length) {
    levels.push(ready);
    visited += ready.length;
    const next = [];
    for (const id of ready) {
      for (const successor of successors.get(id) ?? []) {
        const remaining = pending.get(successor) - 1;
        pending.set(successor, remaining);
        if (remaining === 0) next.push(successor);
      }
    }
    ready = next.sort();
  }
  return visited === nodes.length ? { levels } : { levels: [], cycle: [...pending].filter(([, count]) => count > 0).map(([id]) => id).sort()[0] };
};
function checkpointLayout(state) {
  return layoutNodes(state.nodes).levels;
}
function validateCheckpoints(value, root) {
  if (!isSafeRootPath(root)) return fail("root", "Root must be a safe relative path");
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("checkpoints", "Checkpoints must be an object");
  }
  const checkpoint = value;
  if (checkpoint.version !== 1) return fail("checkpoints.version", "Version must be 1");
  if (checkpoint.template !== void 0 && typeof checkpoint.template !== "string") {
    return fail("checkpoints.template", "Template must be a string");
  }
  if (!Array.isArray(checkpoint.nodes)) return fail("checkpoints.nodes", "Nodes must be an array");
  if (!Array.isArray(checkpoint.documents)) {
    return fail("checkpoints.documents", "Status records must be an array");
  }
  const ids = /* @__PURE__ */ new Set();
  const paths = /* @__PURE__ */ new Set();
  for (let i = 0; i < checkpoint.nodes.length; i++) {
    const node = checkpoint.nodes[i];
    const at = `checkpoints.nodes[${i}]`;
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      return fail(at, "Node must be an object");
    }
    if (typeof node.id !== "string" || !node.id.trim()) {
      return fail(`${at}.id`, "Id must be a non-empty string");
    }
    if (ids.has(node.id)) return fail(`${at}.id`, `Duplicate checkpoint id: ${node.id}`);
    ids.add(node.id);
    if (typeof node.title !== "string" || !node.title.trim()) {
      return fail(`${at}.title`, "Title must be a non-empty string");
    }
    if (!Array.isArray(node.after)) return fail(`${at}.after`, "After must be an array");
    if (!Array.isArray(node.documents)) {
      return fail(`${at}.documents`, "Documents must be an array");
    }
    const predecessors = /* @__PURE__ */ new Set();
    for (let j = 0; j < node.after.length; j++) {
      const predecessor = node.after[j];
      if (typeof predecessor !== "string" || !predecessor.trim()) {
        return fail(`${at}.after[${j}]`, "Predecessor must be a non-empty id");
      }
      if (predecessors.has(predecessor)) {
        return fail(`${at}.after[${j}]`, `Duplicate predecessor: ${predecessor}`);
      }
      predecessors.add(predecessor);
    }
    for (let j = 0; j < node.documents.length; j++) {
      const document = node.documents[j];
      const atDocument = `${at}.documents[${j}]`;
      if (document === null || typeof document !== "object" || Array.isArray(document)) {
        return fail(atDocument, "Document reference must be an object");
      }
      if (typeof document.path !== "string" || !inRoot(document.path, root)) {
        return fail(`${atDocument}.path`, "Path must be safe and within root");
      }
      if (paths.has(document.path)) {
        return fail(`${atDocument}.path`, `Duplicate checkpoint document path: ${document.path}`);
      }
      paths.add(document.path);
      if (document.optional !== void 0 && typeof document.optional !== "boolean") {
        return fail(`${atDocument}.optional`, "Optional must be a boolean");
      }
    }
  }
  for (let i = 0; i < checkpoint.nodes.length; i++) {
    const node = checkpoint.nodes[i];
    for (let j = 0; j < node.after.length; j++) {
      if (!ids.has(node.after[j])) {
        return fail(`checkpoints.nodes[${i}].after[${j}]`, `Unknown predecessor: ${node.after[j]}`);
      }
    }
  }
  const cycle = layoutNodes(checkpoint.nodes).cycle;
  if (cycle) {
    const index = checkpoint.nodes.findIndex((node) => node.id === cycle);
    return fail(`checkpoints.nodes[${index}].after`, "Checkpoint dependency cycle detected");
  }
  const statusPaths = /* @__PURE__ */ new Set();
  for (let i = 0; i < checkpoint.documents.length; i++) {
    const record = checkpoint.documents[i];
    const at = `checkpoints.documents[${i}]`;
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      return fail(at, "Status record must be an object");
    }
    if (typeof record.path !== "string" || !inRoot(record.path, root)) {
      return fail(`${at}.path`, "Path must be safe and within root");
    }
    if (statusPaths.has(record.path)) return fail(`${at}.path`, `Duplicate status path: ${record.path}`);
    statusPaths.add(record.path);
    if (!isStatus(record.status)) return fail(`${at}.status`, "Invalid document status");
    if (!isUtcTimestamp(record.updatedAt)) {
      return fail(`${at}.updatedAt`, "UpdatedAt must be a valid RFC3339 UTC timestamp");
    }
  }
  return { ok: true, value };
}
function checkpointMembership(state) {
  const membership = /* @__PURE__ */ new Map();
  for (const node of state.nodes) {
    for (const document of node.documents) {
      membership.set(document.path, { nodeId: node.id, optional: document.optional === true });
    }
  }
  return membership;
}
function resolveCheckpoints(bundle) {
  const raw = bundle.checkpoints;
  const empty = { raw, nodes: [], documents: [], layout: [], frontier: [], unlinked: [] };
  if (raw === void 0) return { ...empty, valid: true };
  const result = validateCheckpoints(raw, bundle.root);
  if (!result.ok) return { ...empty, valid: false, error: `${result.path}: ${result.err}` };
  const state = result.value;
  const exists = new Set(bundle.files.map((file) => file.path));
  const records = new Map(state.documents.map((record) => [record.path, record]));
  const membership = checkpointMembership(state);
  const layout = checkpointLayout(state);
  const orderedNodes = new Map(state.nodes.map((node) => [node.id, node]));
  const resolved = /* @__PURE__ */ new Map();
  const documents = [];
  const nodes = [];
  for (const level of layout) {
    for (const id of level) {
      const node = orderedNodes.get(id);
      const refs = [...node.documents].sort(
        (a, b) => Number(a.optional === true) - Number(b.optional === true) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      );
      const derived = refs.map((ref) => {
        const record = records.get(ref.path);
        return {
          path: ref.path,
          optional: ref.optional === true,
          status: record?.status ?? "todo",
          exists: exists.has(ref.path),
          ...record && { updatedAt: record.updatedAt }
        };
      });
      documents.push(...derived);
      const required = derived.filter((document) => !document.optional);
      const participating = required.length ? required : derived;
      const aggregate = participating.length === 0 ? "todo" : participating.every((document) => document.status === "freeze") ? "freeze" : participating.every((document) => document.status === "complete" || document.status === "freeze") ? "complete" : participating.every((document) => document.status === "todo") ? "todo" : "in_progress";
      const item = {
        id: node.id,
        title: node.title,
        after: [...node.after].sort(),
        documents: derived,
        aggregate,
        available: node.after.every((predecessor) => resolved.get(predecessor)?.aggregate === "freeze"),
        missing: participating.filter((document) => document.status !== "todo" && !document.exists).map((document) => document.path)
      };
      resolved.set(id, item);
      nodes.push(item);
    }
  }
  const unlinked = state.documents.filter((record) => !membership.has(record.path)).map((record) => ({
    path: record.path,
    optional: false,
    status: record.status,
    updatedAt: record.updatedAt,
    exists: exists.has(record.path)
  })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  documents.push(...unlinked);
  documents.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    raw,
    valid: true,
    state,
    nodes,
    documents,
    layout,
    frontier: nodes.filter((node) => node.available && node.aggregate !== "freeze").map((node) => node.id),
    unlinked
  };
}
const DATA_BLOCK = /<script\b[^>]*\bid=["']taco-document["'][^>]*>([\s\S]*?)<\/script>/i;
async function main() {
  if (process.argv.length !== 3) {
    throw new Error("Usage: node checkpoints.mjs <file.taco.html>");
  }
  const html = await readFile(process.argv[2], "utf8");
  const block = DATA_BLOCK.exec(html);
  if (!block) throw new Error("Taco file does not contain #taco-document");
  const bundle = JSON.parse(block[1]);
  if (!bundle || typeof bundle !== "object" || typeof bundle.root !== "string" || !Array.isArray(bundle.files)) {
    throw new Error("Invalid Taco bundle: expected root and files");
  }
  process.stdout.write(`${JSON.stringify(resolveCheckpoints(bundle))}
`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
