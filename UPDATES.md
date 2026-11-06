# Updates

- Use `gh` with the token in `/workspace/.env` for GitHub authentication. Do not rely on interactive `git` authentication because it can trigger manual UI prompts on the host.
- For upstream pull requests to `bmnielsen/openbw-replay-viewer`, use the Windows host's existing `gh` OAuth keyring login. That is the working method used for PRs #18 and #19; the container's `.env` token is a different credential.
- When integrating upstream OpenBW commits, leave the tested changes unpushed until the human has completed local validation.
- For Remastered, use the direct C++ OpenBW fork and narrow upstream changes. Do not add a Go toolchain or import GPL/LGPL-derived code without explicit approval.

- The default build must produce both the local web viewer and standalone desktop package from matching assets. The `.rep` association must use that maintained output; remove obsolete duplicate releases.
