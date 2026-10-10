import "dotenv/config";
import { setGlobalDispatcher, ProxyAgent } from "undici";
import { GoogleGenAI } from "@google/genai";

// 配置网络代理
setGlobalDispatcher(new ProxyAgent("http://127.0.0.1:8118"));

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  throw new Error("请在 .env 文件中配置 GEMINI_API_KEY");
}

const ai = new GoogleGenAI({ apiKey });

const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

// 1. 定义工具：获取当前北京时间
function getCurrentTime(): string {
  return new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
  });
}

// 2. 向模型描述可用工具
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

// 3. Agent 主流程
async function main() {
  const userMessage = "现在几点了？请查询真实时间后再回答。";

  console.log("用户：", userMessage);

  // 第一次请求：让模型决定如何回答
  const response = await ai.models.generateContent({
    model,
    contents: userMessage,
    config: { tools },
  });

  const calls = response.functionCalls;

  console.log("模型原始文本：", response.text);
  console.log(
    "模型工具调用：",
    JSON.stringify(response.functionCalls, null, 2),
  );

  // 如果模型不需要工具，直接返回答案
  if (!calls || calls.length === 0) {
    console.log("AI 回复 1：", response.text);
    return;
  }

  // 4. 程序执行模型请求的工具
  const results = calls.map((call) => {
    console.log("调用工具：", call.name);

    if (call.name === "get_current_time") {
      return {
        name: call.name,
        response: {
          time: getCurrentTime(),
        },
      };
    }

    throw new Error(`未知工具：${call.name}`);
  });

  console.log("工具真实返回值：", JSON.stringify(results, null, 2));

  // 5. 获取模型的原始响应，保留必要的调用元数据
  const modelContent = response.candidates?.[0]?.content;

  if (!modelContent) {
    throw new Error("Gemini 没有返回模型内容");
  }

  // 6. 将工具结果交给模型，让它组织最终回答
  const finalResponse = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: userMessage }],
      },
      modelContent,
      {
        role: "user",
        parts: results.map((result) => ({
          functionResponse: result,
        })),
      },
    ],
    // config: { tools },
  });
  //   const finalResponse = await ai.models.generateContent({
  //     model,
  //     contents: userMessage,
  //   });

  console.log("AI 回复：", finalResponse.text);
}

main().catch((error) => {
  console.error("运行失败：", error);
  process.exitCode = 1;
});
