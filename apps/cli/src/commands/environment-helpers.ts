import {
  type EnvironmentDisplayInfo,
  type EnvironmentDisplayProviderLookup,
  formatEnvironmentDisplay,
} from "@bb/core-ui";
import type { BbSdk } from "@bb/sdk";
import {
  describeWorkspaceBaseFreshness,
  type WorkspaceBaseFreshness,
} from "@bb/domain";

export interface ThreadEnvironmentInfo {
  display: EnvironmentDisplayInfo;
  hostId: string;
  baseFreshness: WorkspaceBaseFreshness | null;
}

async function resolveEnvironmentProvider(args: {
  environmentProviderId: string | null;
  sdk: BbSdk;
}): Promise<EnvironmentDisplayProviderLookup> {
  if (args.environmentProviderId === null) {
    return { status: "loaded", provider: null };
  }
  const providers = await args.sdk.environments.listProviders();
  const provider = providers.find(
    (candidate) => candidate.id === args.environmentProviderId,
  );
  return {
    status: "loaded",
    provider:
      provider === undefined
        ? null
        : {
            id: provider.id,
            displayName: provider.displayName,
            icon: provider.icon,
          },
  };
}

export async function fetchEnvironmentInfo(args: {
  environmentId: string;
  sdk: BbSdk;
}): Promise<ThreadEnvironmentInfo | null> {
  try {
    const env = await args.sdk.environments.get({
      environmentId: args.environmentId,
    });
    return {
      display: formatEnvironmentDisplay({
        environment: env,
        host: {
          locality: "local",
          identity: null,
        },
        providerLookup: await resolveEnvironmentProvider({
          environmentProviderId: env.environmentProviderId,
          sdk: args.sdk,
        }),
      }),
      hostId: env.hostId,
      baseFreshness: env.baseFreshness,
    };
  } catch {
    return null;
  }
}

export function printEnvironmentInfo(env: ThreadEnvironmentInfo): void {
  console.log(`  Environment: ${env.display.modeLabel} (${env.display.id})`);
  printBaseFreshness(env.baseFreshness, "  ");
}

export function printBaseFreshness(
  freshness: WorkspaceBaseFreshness | null,
  indent: string,
): void {
  if (freshness === null) return;
  const summary = describeWorkspaceBaseFreshness(freshness);
  console.log(
    `${indent}Base freshness: ${summary ?? `up to date with ${freshness.remoteRef ?? freshness.mergeBaseBranch}`}`,
  );
}
