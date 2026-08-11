export function slugifyHeading(text: string, used: Set<string>): string {
  const base = text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'section'
  let slug = base
  let suffix = 2
  while (used.has(slug)) { slug = `${base}-${suffix}`; suffix += 1 }
  used.add(slug)
  return slug
}
