import { homedir } from "os";
import { join } from "path";

export const IGNORE_NAMES = ["node_modules", "dist", "build", "__pycache__", "out"];

const escapedNames = IGNORE_NAMES.map((name) => name.replace(/\./g, "\\."));
// Match hidden folders (e.g. .git, .next) or specific ignored names.
// It explicitly requires a folder separator (not end-of-string) after the hidden folder name
// to distinguish a hidden folder from a hidden file.
// For example, `.git/` will be matched and ignored, but `.gitignore` will not.
export const IGNORE_REGEX = new RegExp(
  `(^|[\\\\/])(\\.[^\\\\/]+|${escapedNames.join("|")})[\\\\/]`,
);

export const DATA_DIR = join(homedir(), ".fello");
export const PROJECTS_DIR = join(DATA_DIR, "projects");

export const SEARCH_MAX_RESULTS = 10;
export const SEARCH_FUSE_THRESHOLD = 0.4;
