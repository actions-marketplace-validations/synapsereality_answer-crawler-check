# Where data/robots.json comes from

`robots.json` is copied unchanged from
[ai-robots-txt/ai.robots.txt](https://github.com/ai-robots-txt/ai.robots.txt),
commit `987266f3c581bc6bb71aa075051731188ab2a075` (2026-09-26), fetched 2026-09-29.
SHA-256 of the file: `49eca349119878d6a8742c298c5f799a24e1779425d1a4f9e0a94ee8f58121a4`.

That project is MIT-licensed. Its licence is in `LICENSE.ai-robots-txt` next to
this file and must travel with the copy.

To refresh it:

```bash
curl -fsSL https://raw.githubusercontent.com/ai-robots-txt/ai.robots.txt/main/robots.json -o data/robots.json
npm test
```

Then update the commit, date and hash above. To use the newest list without
changing the copy, run the CLI with `--list latest`.

If a crawler is missing or described wrongly, fix it upstream with a pull
request to ai.robots.txt, not here.
