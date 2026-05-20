#!/bin/bash
# 清除 VSCode 终端中继承的 ELECTRON_RUN_AS_NODE 环境变量
unset ELECTRON_RUN_AS_NODE
npx electron .
