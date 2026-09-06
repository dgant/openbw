# Updates

- Use `gh` with the token in `/workspace/.env` for GitHub authentication. Do not rely on interactive `git` authentication because it can trigger manual UI prompts on the host.
- When integrating upstream OpenBW commits, leave the tested changes unpushed until the human has completed local validation.

- The default build must produce both the local web viewer and standalone desktop package from matching assets. The `.rep` association must use that maintained output; remove obsolete duplicate releases.
