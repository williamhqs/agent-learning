import "dotenv/config";
import { setGlobalDispatcher, ProxyAgent } from "undici";
import { GoogleGenAI } from "@google/genai";

// 1. 配置网络代理
setGlobalDispatcher(new ProxyAgent("http://127.0.0.1:8118"));

// 2. 初始化 Gemini
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("请在 .env 文件中配置 GEMINI_API_KEY");
}

const ai = new GoogleGenAI({ apiKey });

const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

// 3. 定义工具：获取当前北京时间
function getCurrentTime(): string {
  return new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
  });
}

// 4. 把工具描述告诉模型
const tools = [
  {
    functionDeclarations: [
      {
        name: "get_current_time",
        description: "获取当前的北京时间",
        parameters: {
          type: "OBJECT",
          properties: {},
        },
      },
    ],
  },
];

// 5. 程序负责真正执行工具
function executeTool(name: string): object {
  switch (name) {
    case "get_current_time":
      return {
        time: getCurrentTime(),
      };

    default:
      throw new Error(`未知工具：${name}`);
  }
}

// 6. Agent 主流程
async function main() {
  const userMessage = "现在北京时间几点了？请查询后回答。";

  console.log("用户：", userMessage);

  // 保存完整对话，供后续轮次继续使用
  const contents: any[] = [
    {
      role: "user",
      parts: [{ text: userMessage }],
    },
  ];

  const maxTurns = 5;

  // Agent Loop：最多运行 5 轮
  for (let turn = 1; turn <= maxTurns; turn++) {
    console.log(`\n--- 第 ${turn} 轮 ---`);

    const response = await ai.models.generateContent({
      model,
      contents,
      config: { tools },
    });

    const modelContent = response.candidates?.[0]?.content;

    if (!modelContent) {
      throw new Error("Gemini 没有返回模型内容");
    }

    const calls = response.functionCalls;

    // 模型没有请求调用工具，说明它准备直接回答
    if (!calls || calls.length === 0) {
      console.log("AI 最终回答：", response.text);
      return;
    }

    // 保留模型原始内容，不要手动重建 functionCall
    // 其中可能包含 Gemini 工具调用所需的元数据
    contents.push(modelContent);

    // 执行本轮所有工具调用
    const functionResponseParts = calls.map((call) => {
      if (!call.name) {
        throw new Error("模型返回了没有名称的工具调用");
      }

      console.log("调用工具：", call.name);
      console.log("工具参数：", call.args);

      const result = executeTool(call.name);

      console.log("工具结果：", result);

      return {
        functionResponse: {
          name: call.name,
          id: call.id,
          response: result,
        },
      };
    });

    // 把工具结果追加到对话中
    contents.push({
      role: "user",
      parts: functionResponseParts,
    });

    // 不直接 return，进入下一轮，让模型继续处理结果
  }

  throw new Error(`Agent 超过最大运行轮数：${maxTurns}`);
}

main().catch((error) => {
  console.error("运行失败：", error);
  process.exitCode = 1;
});
