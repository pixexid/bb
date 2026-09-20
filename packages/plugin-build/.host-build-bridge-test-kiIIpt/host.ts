import { experimental_compareVersions, experimental_defineProviderBridge, threadDeltaSchema, threadStartParamsSchema } from "@get-bb/plugin-sdk/provider-bridge";
export const compareVersions = experimental_compareVersions;
export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine(line) {
    threadStartParamsSchema.safeParse(JSON.parse(line));
    process.stdout.write(JSON.stringify(threadDeltaSchema.parse({ kind: "turn.open" })));
  },
});
export default {};