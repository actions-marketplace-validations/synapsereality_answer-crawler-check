# Releasing answer-crawler-check

Nothing here has happened yet. Every step below is yours, from your own
accounts. The org name `synapsereality` is a placeholder. If you pick another
name, replace it everywhere with
`grep -rl --exclude-dir=.git synapsereality/ . | xargs sed -i 's#synapsereality/#NEWNAME/#g'`
(that leaves the synapsereality.io URLs alone), then commit.

## Once, for all three repos: the GitHub org

1. Create the org at https://github.com/account/organizations/new (Free plan),
   named `synapsereality`.
2. Org settings, Authentication security: tick "Require two-factor
   authentication". Marketplace publishing needs 2FA anyway.

## Once, for this repo

3. Create an empty public repo `synapsereality/answer-crawler-check`, with no README, licence
   or .gitignore, then push:

   ```bash
   cd ~/Documents/ben-is-a-dev/oss/answer-crawler-check
   git remote add origin git@github.com:synapsereality/answer-crawler-check.git
   git push -u origin main
   ```

4. Set the website field. It is the link people copy into tutorials, so it has
   to be our docs page and not GitHub:

   ```bash
   gh repo edit synapsereality/answer-crawler-check \
     --homepage https://synapsereality.io/open-source/answer-crawler-check/ \
     --description "Fail CI when robots.txt blocks an AI answer crawler from any page in your sitemap." \
     --add-topic robots-txt --add-topic ai-crawlers --add-topic seo --add-topic aeo --add-topic github-action
   ```

5. Repo Settings, Environments, New environment, named `npm`. Add yourself
   under "Required reviewers" if you want to click Approve before each upload.
   The release workflow waits for that click.

6. Publish the docs page first (`SITE-PAGE.md` in this folder, not in git) at
   https://synapsereality.io/open-source/answer-crawler-check/. The README and the package
   metadata already link to it.

## Once: the first npm release, by hand

npm only lets you add a trusted publisher to a package that already exists.
So version 0.1.0 goes up from your machine, and every later version comes from
the workflow.

7. Make sure your npm account has 2FA on, then:

   ```bash
   cd ~/Documents/ben-is-a-dev/oss/answer-crawler-check
   git status          # must be clean, on the commit you pushed
   npm login
   npm test
   npm publish --access public
   ```

   The name was free on 2026-09-29.

8. On https://www.npmjs.com/package/answer-crawler-check, Settings, Trusted
   Publisher, GitHub Actions:

   | field | value |
   |---|---|
   | Organization or user | `synapsereality` |
   | Repository | `answer-crawler-check` |
   | Workflow filename | `release.yml` |
   | Environment name | `npm` |
   | Allowed actions | allow `npm publish` |

   Then, on the same Settings page, Publishing access: pick "Require two-factor
   authentication and disallow tokens". From here on only the workflow can
   publish.

## Every release

9. For 0.1.0 the package is already on npm from step 7. The workflow sees that
   and skips the upload. For later versions, bump `version` in `package.json`
   and `CITATION.cff`, commit and push.
10. On GitHub: Releases, Draft a new release. Tag `v0.1.0` (create it on
    publish), target `main`, title `v0.1.0`.

   Under "Release Action", tick "Publish this Action to the GitHub
   Marketplace". The first time, the box is greyed out until you follow the
   link and accept the GitHub Marketplace Developer Agreement for the org.
   Pick "Continuous integration" as the primary category and "Utilities" as
   the second. The name in `action.yml` (answer-crawler-check) must not already be
   taken on the Marketplace. If it is, change `name:` in `action.yml` and
   commit before you release. Click Publish release.
11. The `release` workflow checks that the tag matches the version, runs the
    tests and publishes with provenance. Check it under Actions, then:

    ```bash
    npx answer-crawler-check@0.1.0 --version
    ```

## Zenodo DOI (optional for this repo, before the first release)

Zenodo archives releases published after the switch is on. So flip it before
you publish the first release, or make a second release afterwards.

1. Log in at https://zenodo.org with GitHub. When GitHub asks, grant access to
   the `synapsereality` org.
2. Zenodo, account menu, GitHub: find `synapsereality/answer-crawler-check` and switch it on.
   Zenodo reads `.zenodo.json` for the title, creators, licence and links.
3. After the release, Zenodo shows two DOIs. Use the concept DOI, which always
   points to the latest version. Uncomment the `doi:` line in `CITATION.cff`,
   put it in, add a DOI line to the README, and commit.

## What is not automated, on purpose

No token for PyPI, npm or GitHub is stored in the repo or its secrets. The
workflows get a short-lived OIDC token from GitHub, valid for that one job, for
this repo, this workflow file and this environment.
