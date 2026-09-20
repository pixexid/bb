export interface ProvisioningBaseRefInputs {
  localRef: string | null;
  remoteRef: string | null;
  localSha: string | null;
  remoteSha: string | null;
  localIsAncestorOfRemote: boolean | null;
}

export function chooseProvisioningBaseRef(
  inputs: ProvisioningBaseRefInputs,
): string | null {
  if (inputs.remoteRef === null || inputs.remoteSha === null) {
    return inputs.localRef;
  }
  if (inputs.localRef === null || inputs.localSha === null) {
    return inputs.remoteRef;
  }
  if (inputs.localSha === inputs.remoteSha) {
    return inputs.remoteRef;
  }
  return inputs.localIsAncestorOfRemote === false
    ? inputs.localRef
    : inputs.remoteRef;
}
