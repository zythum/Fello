import { mkdirSync } from "fs";
import { FELLO_DIR, PROJECTS_DIR, SOCKETS_DIR, TEMP_DIR } from "./constant";

// 确保所有基础目录在模块初始化时创建。
// 注意：被配置的数据根（环境变量 / ~/.fellorc）由 resolveDataRoot 校验并
// 拒绝自动创建——移动盘没挂载时必须报错，而不是在系统盘上悄悄建一个空目录。
mkdirSync(FELLO_DIR, { recursive: true });
mkdirSync(PROJECTS_DIR, { recursive: true });
mkdirSync(SOCKETS_DIR, { recursive: true });
mkdirSync(TEMP_DIR, { recursive: true });
