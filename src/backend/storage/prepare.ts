import { mkdirSync } from "fs";
import { ASSISTANT_WORKSPACE, FELLO_DIR, PROJECTS_DIR, SOCKETS_DIR, TEMP_DIR } from "./constant";

// 确保所有基础目录在模块初始化时创建
mkdirSync(FELLO_DIR, { recursive: true });
mkdirSync(PROJECTS_DIR, { recursive: true });
mkdirSync(SOCKETS_DIR, { recursive: true });
mkdirSync(TEMP_DIR, { recursive: true });
mkdirSync(ASSISTANT_WORKSPACE, { recursive: true });
