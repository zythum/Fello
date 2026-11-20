import { join } from "path";
import { homedir } from "os";

export const FELLO_DIR = join(homedir(), ".fello");
export const SOCKETS_DIR = join(FELLO_DIR, "sockets");
export const PROJECTS_DIR = join(FELLO_DIR, "projects");
export const TEMP_DIR = join(FELLO_DIR, "temp");
/** Fixed workspace used by the Personal Assistant and its workers. */
export const ASSISTANT_WORKSPACE = join(FELLO_DIR, "workspaces", "__assistant__");
