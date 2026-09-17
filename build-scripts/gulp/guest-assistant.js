import gulp from "gulp";
import "./clean.js";
import "./compress.js";
import "./entry-html.js";
import "./gather-static.js";
import "./gen-icons-json.js";
import "./locale-data.js";
import "./rspack.js";
import "./translations.js";

gulp.task(
  "develop-guest-assistant",
  gulp.series(
    async function setEnv() {
      process.env.NODE_ENV = "development";
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
    },
    "clean-guest-assistant",
    gulp.parallel(
      "gen-icons-json",
      "build-guest-assistant-translations",
      "build-locale-data"
    ),
    "copy-static-guest-assistant",
    "rspack-prod-guest-assistant",
    "gen-pages-guest-assistant-prod"
  )
);
