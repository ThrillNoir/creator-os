export type DeploymentMetadataInput = {
  buildTime?: string;
  component?: string;
  environment?: string;
  gitBranch?: string;
  gitSha?: string;
};

export function getDeploymentMetadata(input: DeploymentMetadataInput = {}) {
  return {
    component: input.component ?? process.env.THOT_OS_COMPONENT ?? "web",
    environment: input.environment ?? process.env.THOT_OS_ENVIRONMENT ?? "local",
    gitSha: input.gitSha ?? process.env.THOT_OS_GIT_SHA ?? "unknown",
    gitBranch: input.gitBranch ?? process.env.THOT_OS_GIT_BRANCH ?? "unknown",
    buildTime: input.buildTime ?? process.env.THOT_OS_BUILD_TIME ?? "unknown",
  };
}
