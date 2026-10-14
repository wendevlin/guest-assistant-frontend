import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import gulp from "gulp";
import paths from "../paths.cjs";
import "./clean.js";
import "./compress.js";
import "./entry-html.js";
import "./gather-static.js";
import "./gen-icons-json.js";
import "./locale-data.js";
import "./rspack.js";
import "./translations.js";

/**
 * Id of a production build: the release tag in CI (GUEST_ASSISTANT_BUILD, see
 * .github/workflows/guest-assistant.yaml), otherwise one that is new for every
 * local build. The bundle and build.json get the same one; the app reloads
 * when the proxy serves another (guest-assistant/src/data/guest-update.ts).
 */
const productionBuildId = () => {
  if (process.env.GUEST_ASSISTANT_BUILD) {
    return process.env.GUEST_ASSISTANT_BUILD;
  }
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch (_err) {
    // not a git checkout
  }
  const time = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
  return `local-${commit}-${time}`;
};

gulp.task("gen-build-info-guest-assistant", async () => {
  fs.writeFileSync(
    path.resolve(paths.guestAssistant_output_root, "build.json"),
    JSON.stringify({ build: process.env.GUEST_ASSISTANT_BUILD })
  );
});

gulp.task(
  "develop-guest-assistant",
  gulp.series(
    async function setEnv() {
      process.env.NODE_ENV = "development";
      process.env.GUEST_ASSISTANT_BUILD = "dev";
    },
    "clean-guest-assistant",
    gulp.parallel(
      "gen-icons-json",
      gulp.series(
        "translations-enable-merge-backend",
        "build-guest-assistant-translations"
      ),
      "build-locale-data"
    ),
    "copy-static-guest-assistant",
    "gen-pages-guest-assistant-dev",
    "rspack-watch-guest-assistant"
  )
);

gulp.task(
  "build-guest-assistant",
  gulp.series(
    async function setEnv() {
      process.env.NODE_ENV = "production";
      process.env.GUEST_ASSISTANT_BUILD = productionBuildId();
    },
    "clean-guest-assistant",
    gulp.parallel(
      "gen-icons-json",
      "build-guest-assistant-translations",
      "build-locale-data"
    ),
    "copy-static-guest-assistant",
    "rspack-prod-guest-assistant",
    "gen-pages-guest-assistant-prod",
    "gen-build-info-guest-assistant"
  )
);
