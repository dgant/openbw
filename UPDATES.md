# Collaboration Practices

- Use `gh` with the token in `/workspace/.env` for GitHub authentication. Do not rely on interactive `git` authentication because it can trigger manual UI prompts on the host.
- If the container token lacks repository permissions, check the Windows host's
  `gh` OAuth keyring login before requesting new credentials.
- When integrating upstream OpenBW commits, leave the tested changes unpushed until the human has completed local validation.
- Maintain classic and Remastered as peer C++ engines in this repository. Edit and build their checked-in sources directly, without an upstream submodule or build-time patches. Do not add a Go toolchain or import GPL/LGPL-derived code without explicit approval.

- The default build must produce both the local web viewer and standalone desktop package from matching assets. The `.rep` association must use that maintained output.

- Name Remastered implementation files, directories, and documentation after the
  feature, not the upstream author. Keep author names only for source provenance.
- Maintain documentation as a current reference: requirements, operating
  instructions, and reusable lessons. Keep progress reports, incident timelines,
  and completed-work summaries in Git history, not in these files.
- Describe the local implementation directly. Omit unnecessary external project
  names and license disclaimers from prose; preserve factual asset provenance.
- Build Remastered from this repository's pre-Remastered OpenBW engine, with
  only the local changes required for correct Remastered playback. Do not
  import code from external engine forks. Keep shared behavior on the same
  paths and verify the actual engine diff, not just the directory layout.
- Diagnose failing regressions before changing their assertions. Fix product
  behavior when broken; otherwise stabilize the test without weakening coverage.
- Keep PR history free of discarded external integrations. Squash the final
  required changes before review; do not retain unnecessary imported code in
  intermediate PR commits or task milestone tags.
- Treat the viewer as a production release. Verify behavior and failure recovery
  before claiming readiness; an "experimental" label does not substitute for
  testing. State the supported scope and remaining evidence gaps explicitly.
