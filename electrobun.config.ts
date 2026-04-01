import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Fello",
    identifier: "fello.app.dev",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  build: {
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
      icons: "icons/icon.iconset",
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
