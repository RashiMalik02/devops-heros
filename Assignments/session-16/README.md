# Session 16: CI/CD and GitHub Actions

**Submitted by:** Rashi
**Roll No:** 10389
**Batch:** B

GitHub only runs workflow files that are in the **root** `.github/workflows/` folder of a
repository, so I put the session's calculator app and all eight workflows into a separate repository.
The app, tests, build script and workflows are the ones from
[10-final-cicd-pipeline](../../session-16-github-actions/session-16-github-actions/10-final-cicd-pipeline)
and folders `03`–`09`.

- **Repository:** https://github.com/RashiMalik02/session16-cicd-github-actions
- **Workflow runs:** https://github.com/RashiMalik02/session16-cicd-github-actions/actions

GitHub only shows step *logs* to signed-in users, so for most runs there are two screenshots: the
run page on GitHub, and the same run's log pulled with `gh run view --log`. I piped the log through
a small filter (`tidylog`) that drops the runner's setup/cleanup noise and keeps each step's own
output under a `job > step` heading.

## 1. CI vs CD

| CI (Continuous Integration) | CD (Continuous Delivery / Deployment) |
|---|---|
| Every push/PR is built and tested automatically | Code that passed CI is packaged and released |
| Finds broken code within minutes of the commit | Removes manual, error-prone release steps |
| Build, test, lint, scan | Delivery = ready to release with a manual approval; Deployment = released automatically |

## 2. CI/CD Pipeline

A pipeline is a chain of automated stages. If a stage fails, the stages after it don't run, so
broken code never gets packaged or deployed.

```text
Checkout  ->  Install  ->  Test  ->  Build  ->  Package (artifact)  ->  Deploy
```

## 3. Running the Project Locally

Before pushing, I checked that the app, tests and build script work on my machine. These are the
same steps the pipeline runs.

### Running the Application

![calculator running](./Screenshots/img_1.png)

### Installing Dependencies and Running Tests

![venv and pytest](./Screenshots/img_2.png)

### Building the Application

`build.sh` copies the app into `build/` and writes `build-info.txt`, which is the "build output"
the pipeline later uploads as an artifact.

![build script](./Screenshots/img_3.png)

## 4. Pushing to GitHub

`gh repo create --source . --push` created the public repository and pushed `main`. The push
immediately triggered the two workflows that listen on `push`.

![git init, commit, gh repo create](./Screenshots/img_4.png)

![repository on github](./Screenshots/img_5.png)

## 5. GitHub Actions

GitHub Actions is the automation platform built into GitHub. A YAML file in `.github/workflows/`
says *when* to run (`on:`) and *what* to run (jobs and steps), and GitHub runs it on its own
machines. The Actions tab lists every run: the push-triggered pipelines, the manual demos, and
the intentional failure and its fix.

```text
Repository  ->  Workflow (.yml)  ->  Jobs  ->  Steps
```

![actions tab](./Screenshots/img_6.png)

## 6. Workflows

A workflow is triggered by an event. The common ones are `push`, `pull_request`, `schedule` (cron)
and `workflow_dispatch` (a manual "Run workflow" button). The demo workflows here use
`workflow_dispatch` and were started with `gh workflow run`. Each step ran in order.

![workflow demo job](./Screenshots/img_7.png)

![workflow demo log](./Screenshots/img_7b.png)

## 7. Jobs and Steps

- A **job** is a group of steps that runs on one runner.
- A **step** is a single command (`run:`) or a reusable action (`uses:`).
- Jobs run **in parallel** by default. `needs:` makes one wait for another.

`Build Job` and `Test Job` have no `needs:`, so they ran side by side.

![jobs and steps graph](./Screenshots/img_8.png)

![jobs and steps log](./Screenshots/img_8b.png)

## 8. Runners

A runner is the machine that executes a job. `runs-on: ubuntu-latest` gives a fresh GitHub-hosted
Ubuntu VM for every job (here an Azure VM with Python 3.12 preinstalled). It starts with an empty
workspace (`ls -la` shows nothing because this workflow has no checkout step) and is thrown away
afterwards. Self-hosted runners are your own machines registered to the repo.

![runner demo](./Screenshots/img_9.png)

## 9. Secrets

Passwords and tokens go in **Settings > Secrets and variables > Actions** (or `gh secret set`),
never in the YAML or the code. A workflow reads them with `${{ secrets.NAME }}` and GitHub masks
the value as `***` in logs.

### Creating the Secret

I ran Secrets Demo **before** creating the secret: `DEMO_SECRET` was empty, so the step printed
"Secret is not configured." and failed. Then I created the secret. The value came from an
environment variable, so it never appeared on screen or in Git.

![secret before and creation](./Screenshots/img_10.png)

### Using the Secret in a Workflow

The second run passed and the value shows as `***` in the log.

![secrets demo success](./Screenshots/img_11.png)

## 10. Artifacts

An artifact is a file produced by a run that GitHub keeps after the runner is destroyed, such as
a build folder or a test report. Git stores the source code, and artifacts store what the pipeline
built from it.

### Artifact Workflow Run

![artifact run](./Screenshots/img_12.png)

### Downloading the Artifact

![gh run download](./Screenshots/img_13.png)

## 11. Build and Test Pipeline

One job that checks out the code, sets up Python 3.12, installs dependencies, runs the 5 tests,
builds, and uploads `build/` as `calculator-build`. It runs on every push and PR to `main`.

![build and test job](./Screenshots/img_14.png)

![build and test log](./Screenshots/img_14b.png)

## 12. Final CI/CD Pipeline

Three jobs. `build` and `security-check` both have `needs: test`, so they only start after the
tests pass, and they run in parallel with each other.

```text
test  ->  build           ->  calculator-build artifact
      ->  security-check  (fails if .env / *.pem / *.key files are in the repo)
```

### Successful Pipeline

![final pipeline success](./Screenshots/img_15.png)

### Build Artifact

![final pipeline build and security output](./Screenshots/img_16.png)

![download calculator-build](./Screenshots/img_16b.png)

### Failure Test

I changed `add()` to return `a + b + 1`. The test failed locally (`assert 16 == 15`), and after
pushing, both pipelines failed on GitHub too.

![failing test locally and push](./Screenshots/img_17.png)

In the Final CI Pipeline, `Test Application` failed, so `Build Application` and `Security Check`
were **skipped**, and no artifact was produced for the broken code. That's the point of `needs:`.

![failed pipeline on github](./Screenshots/img_18.png)

![failed pipeline log](./Screenshots/img_18b.png)

### Fix

Restoring `add()` made the tests pass locally, and the push produced green runs for both pipelines.

![fix and push](./Screenshots/img_19.png)

![fixed pipeline](./Screenshots/img_19b.png)

## Key Learnings

- **CI** checks every push automatically. **CD** moves code that passed towards users.
- **Workflow > Jobs > Steps**, and every job runs on a fresh **runner**.
- `needs:` stops later jobs when an earlier one fails, so broken code is never built or shipped.
- **Secrets** keep credentials out of code and are masked in logs. **Artifacts** keep build output
  after the run.
