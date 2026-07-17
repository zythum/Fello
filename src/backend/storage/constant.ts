import { join } from "path";
import { homedir } from "os";

export const FELLO_DIR = join(homedir(), ".fello");
export const SOCKETS_DIR = join(FELLO_DIR, "sockets");
export const PROJECTS_DIR = join(FELLO_DIR, "projects");
export const TEMP_DIR = join(FELLO_DIR, "temp");
