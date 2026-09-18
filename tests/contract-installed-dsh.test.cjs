const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const virtualPath = path.join(__dirname, "contract-installed-dsh.virtual.ts");

// 只供升级检查使用：这些包是已安装 dsh 的组成部分，不是生产代码的隐式依赖。
// 只使用公开出口，不读取 lib 内部路径，不依赖版本号相等来代替形状检查。
// JSON 动态内容（事件 data、assistant chunk、插件投影）不在静态类型覆盖范围内。
const contract = `
import type {} from '@deepseek-ai/dsh-api-session-controller/remote';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote';
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote';
import type {} from '@deepseek-ai/dsh-commands/remote';
import type {} from '@deepseek-ai/dsh-llm/remote';
import type { TypertRemoteMap } from '@deepseek-ai/dsh-typert-protocol';
import type * as S from '@deepseek-ai/dsh-api-session-controller/types';
import type * as W from '@deepseek-ai/dsh-api-workspace-controller/types';
import type { SettingsDescribeValue } from '@deepseek-ai/dsh-settings/types';
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types';
import type { AskUserQuestionRequestEvent, AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/types';
import type { CommandDescriptor as UpstreamCommandDescriptor } from '@deepseek-ai/dsh-commands/types';
import type * as UI from '../src/renderer/src/native/protocol';
import { Endpoints } from '../src/renderer/src/native/protocol';

// 消除仅存在于宿主内存的 readonly，不放宽 wire 字段类型或必填性。
type Mutable<T> = T extends string | number | boolean | null | undefined ? T
  : T extends readonly (infer V)[] ? Mutable<V>[]
  : { -readonly [K in keyof T]: Mutable<T[K]> };
type Assert<T extends true> = T;
type Fits<From, To> = [From] extends [To] ? true : false;
export type Remote = TypertRemoteMap;
export type EndpointsExist = Assert<Fits<Exclude<(typeof Endpoints)[keyof typeof Endpoints], '$events/result'>, keyof Remote>>;
export type Catalog = Assert<Fits<Mutable<S.ModelCatalog>, UI.ModelCatalog>>;
// UI 的可选字段仍是已知能力：上游删除字段也应提示升级审查，不能因 optional 而漏检。
export type CatalogFields = Assert<Fits<keyof UI.ModelCatalog, keyof S.ModelCatalog>>;
export type CatalogModelFields = Assert<Fits<keyof UI.ModelCatalogModel, keyof S.ModelCatalogModel>>;
export type ReasoningFields = Assert<Fits<keyof UI.ModelReasoning, keyof S.ModelReasoning>>;
export type ModelSelection = Assert<Fits<S.ModelSelectionProjection, UI.ModelSelectionProjection>>;
export type Sessions = Assert<Fits<Mutable<Omit<S.SessionSummary, 'projections'>>, Omit<UI.SessionSummary, 'projections'>>>;
export type SessionFields = Assert<Fits<keyof UI.SessionSummary, keyof S.SessionSummary>>;
export type Attachments = Assert<Fits<Mutable<S.SessionAttachmentValue>, UI.SessionAttachmentResult>>;
export type Settings = Assert<Fits<SettingsDescribeValue, UI.SettingsDescribeValue>>;
export type Workspace = Assert<Fits<Mutable<W.WorkspaceFollowFrame>, UI.WorkspaceFollowFrame>>;
export type History = Assert<Fits<Mutable<S.SessionHistoryRecord>, UI.SessionHistoryRecord>>;
export type Snapshot = Assert<Fits<Mutable<Omit<Extract<S.SessionFollowFrame, {type: 'snapshot'}>, 'assistantStream' | 'projections'>>, Omit<UI.SessionFollowSnapshot, 'assistantStream' | 'projections'>>>;
export type SnapshotFields = Assert<Fits<keyof UI.SessionFollowSnapshot, keyof Extract<S.SessionFollowFrame, {type: 'snapshot'}>>>;
export type FollowKinds = Assert<Fits<S.SessionFollowFrame['type'], UI.SessionFollowFrame['type']>>;
export type AssistantStart = Assert<Fits<Extract<S.SessionAssistantStreamFrame, {type: 'start'}>, Extract<UI.AssistantStreamFrame, {type: 'start'}>>>;
export type AssistantEnd = Assert<Fits<Extract<S.SessionAssistantStreamFrame, {type: 'end'}>, Extract<UI.AssistantStreamFrame, {type: 'end'}>>>;
export type AssistantChunk = Assert<Fits<Omit<Extract<S.SessionAssistantStreamFrame, {type: 'chunk'}>, 'chunk'>, Omit<Extract<UI.AssistantStreamFrame, {type: 'chunk'}>, 'chunk'>>>;
export type ApprovalRequest = Assert<Fits<Omit<ApprovalRequestEvent, 'agent' | 'signal'>, UI.ApprovalRequestPayload>>;
export type ApprovalAnswer = Assert<Fits<'allowed-once' | 'rejected', ApprovalOutcome>>;
export type QuestionRequest = Assert<Fits<Omit<AskUserQuestionRequestEvent, 'agent' | 'signal'>, UI.UserQuestionsRequestPayload>>;
export type QuestionAnswer = Assert<Fits<{answers: UI.UserQuestionAnswer[]}, AskUserQuestionAnswer>>;
export type Commands = Assert<Fits<Mutable<UpstreamCommandDescriptor>, UI.CommandDescriptor>>;
export type CommandFields = Assert<Fits<keyof UI.CommandDescriptor, keyof UpstreamCommandDescriptor>>;
`;

function createContractProgram(source = contract) {
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  host.readFile = (file) =>
    path.resolve(file) === virtualPath ? source : read(file);
  const program = ts.createProgram([virtualPath], options, host);
  const errors = ts.getPreEmitDiagnostics(program);
  assert.equal(
    errors.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (file) => file,
      getNewLine: () => "\n",
    }),
  );
  return program;
}

test("已安装引擎的公开契约与界面关键视图兼容", () => {
  createContractProgram();
});

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(file)
      : /\.tsx?$/.test(file)
        ? [file]
        : [];
  });
}

test("真实 RPC 与 follow 调用的具名参数符合上游签名", () => {
  const program = createContractProgram();
  const checker = program.getTypeChecker();
  const virtual = program.getSourceFile(virtualPath);
  const remoteAlias = virtual.statements.find(
    (item) => ts.isTypeAliasDeclaration(item) && item.name.text === "Remote",
  );
  const remote = checker.getTypeFromTypeNode(remoteAlias.type);
  const protocolPath = path.join(root, "src/renderer/src/native/protocol.ts");
  const protocol = program.getSourceFile(protocolPath);
  const endpointDeclaration = protocol.statements
    .flatMap((item) =>
      ts.isVariableStatement(item)
        ? [...item.declarationList.declarations]
        : [],
    )
    .find((item) => item.name.getText(protocol) === "Endpoints");
  const endpoints = checker.getTypeAtLocation(endpointDeclaration.name);
  const covered = new Set();

  for (const file of sourceFiles(path.join(root, "src/renderer/src/native"))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      if (ts.isCallExpression(node) && node.arguments.length >= 2) {
        const method = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : node.expression.getText(source);
        const [endpoint, payload] = node.arguments;
        if (
          ["rpc", "dshStreamOpen", "openStream"].includes(method) &&
          ts.isPropertyAccessExpression(endpoint) &&
          endpoint.expression.getText(source) === "Endpoints"
        ) {
          const endpointName = endpoint.name.text;
          const endpointSymbol = endpoints.getProperty(endpointName);
          assert.ok(endpointSymbol, "未声明的界面端点：" + endpointName);
          const wireName = checker.getTypeOfSymbolAtLocation(
            endpointSymbol,
            endpointDeclaration,
          ).value;
          const remoteMethod = remote.getProperty(wireName);
          assert.ok(remoteMethod, "上游已移除端点：" + wireName);
          const signature = checker
            .getTypeOfSymbolAtLocation(remoteMethod, virtual)
            .getCallSignatures()[0];
          const params = signature
            .getParameters()
            .filter((param) => param.name !== "signal");
          assert.ok(
            ts.isObjectLiteralExpression(payload),
            wireName + " 使用动态载荷，需显式补充契约覆盖",
          );
          assert.ok(
            payload.properties.every((prop) => !ts.isSpreadAssignment(prop)),
            wireName + " 使用展开载荷，需显式补充契约覆盖",
          );
          const keys = payload.properties.map((prop) =>
            prop.name.getText(source).replace(/^['"]|['"]$/g, ""),
          );
          const allowed = params.map((param) => param.name);
          const required = params
            .filter((param) => {
              const declaration = param.valueDeclaration;
              const type = checker.getTypeOfSymbolAtLocation(param, virtual);
              const optional =
                type.flags & ts.TypeFlags.Undefined ||
                (type.isUnion() &&
                  type.types.some(
                    (part) => part.flags & ts.TypeFlags.Undefined,
                  ));
              return !declaration?.questionToken && !optional;
            })
            .map((param) => param.name);
          assert.deepEqual(
            keys.filter((key) => !allowed.includes(key)),
            [],
            wireName + " 包含上游不接受的具名参数",
          );
          assert.deepEqual(
            required.filter((key) => !keys.includes(key)),
            [],
            wireName + " 缺少上游必填参数",
          );
          covered.add(wireName);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  // 回执由桥单独发送并测试；其余声明端点必须在真实调用中被检查，防止拆分后悄悄漏检。
  const expected = endpoints
    .getProperties()
    .map(
      (symbol) =>
        checker.getTypeOfSymbolAtLocation(symbol, endpointDeclaration).value,
    )
    .filter((name) => name !== "$events/result");
  assert.deepEqual([...covered].sort(), expected.sort());
});
