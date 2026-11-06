#!/usr/bin/env node
// A deterministic app-server fixture. It never opens user configuration or task files.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const threadId = "2699d524-2a4c-4ec2-81ec-7b52d6ac7cb0";
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notice = (method, params) => send({ method, params });
if (process.argv.includes("--version")) {
  console.log("codex-cli 0.0.0-fixture");
  process.exit(0);
}
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  const { id, method, params = {} } = request;
  if (id === 901 && !method) {
    appendFileSync(process.env.TANDEM_INTEROP_CLI_LOG, "answered\n");
    notice("serverRequest/resolved", { requestId: 901 });
    notice("item/agentMessage/delta", {
      itemId: "reply",
      delta: "已记录你的选择。",
    });
    notice("turn/completed", {
      threadId,
      turn: { id: "turn-1", status: "completed", error: null },
    });
    continue;
  }
  if (id === undefined) continue;
  appendFileSync(process.env.TANDEM_INTEROP_CLI_LOG, `${method}\n`);
  let result = {};
  switch (method) {
    case "initialize":
      result = { userAgent: "tandem-interop-fixture" };
      break;
    case "thread/list":
      result = { data: [], nextCursor: null };
      break;
    case "thread/start":
    case "thread/resume":
      result = { thread: { id: threadId, cwd: params.cwd }, model: "fixture" };
      break;
    case "thread/items/list":
      result = { data: [], nextCursor: null };
      break;
    case "model/list":
      result = {
        data: [
          {
            id: "fixture",
            model: "fixture",
            displayName: "Fixture",
            description: "",
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" },
            ],
          },
        ],
        nextCursor: null,
      };
      break;
    case "config/read":
      result = {
        config: { model: "fixture", model_reasoning_effort: "medium" },
      };
      break;
    case "account/rateLimits/read":
      result = { rateLimits: {} };
      break;
    case "account/read":
      result = { account: null, requiresOpenaiAuth: false };
      break;
    case "turn/start":
      result = { turn: { id: "turn-1", status: "inProgress" } };
      break;
    case "thread/loaded/list":
      result = { data: [] };
      break;
    default:
      result = {};
      break;
  }
  send({ id, result });
  if (method === "turn/start") {
    notice("item/agentMessage/delta", {
      itemId: "reply",
      delta: "来自替身 CLI 的回复。",
    });
    send({
      id: 901,
      method: "item/tool/requestUserInput",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "question",
        questions: [
          {
            id: "color",
            header: "颜色",
            question: "选哪个颜色？",
            options: [
              { label: "红", description: "红色" },
              { label: "蓝", description: "蓝色" },
            ],
          },
        ],
      },
    });
  }
}
