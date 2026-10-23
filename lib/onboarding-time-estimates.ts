type EstimatePlacement = "next-action" | "task";

type TaskEstimate = {
  minutes?: number;
  nextActionLabel?: string;
  taskLabel: string;
};

const taskEstimates = {
  "task-1": {
    minutes: 30,
    nextActionLabel: "30-min session",
    taskLabel: "Meeting: 30-min session"
  },
  "import-your-passwords": {
    minutes: 5,
    nextActionLabel: "Est. 5 min",
    taskLabel: "Est. 5 min"
  },
  "task-2": {
    minutes: 2,
    nextActionLabel: "Est. 2 min",
    taskLabel: "Est. 2 min"
  },
  "task-3": {
    minutes: 5,
    nextActionLabel: "Est. 5 min",
    taskLabel: "Est. 5 min"
  },
  "task-4": {
    minutes: 2,
    nextActionLabel: "Est. 2 min",
    taskLabel: "Est. 2 min"
  },
  "task-5": {
    minutes: 10,
    nextActionLabel: "Est. 10 min",
    taskLabel: "MSP effort: ~10 min"
  },
  "task-6": {
    taskLabel: "Timing varies"
  },
  "task-8": {
    nextActionLabel: "Implementation: 30 min per application",
    taskLabel: "Implementation session: 30 min per application"
  },
  "task-9": {
    minutes: 5,
    nextActionLabel: "Est. 5 min",
    taskLabel: "Initial preparation: ~5 min"
  }
} satisfies Record<string, TaskEstimate>;

type StableTaskKey = keyof typeof taskEstimates;

const tenantSetupTaskKeys = ["import-your-passwords", "task-2", "task-3", "task-4"] satisfies StableTaskKey[];

export const TENANT_SETUP_TOTAL_MINUTES = tenantSetupTaskKeys.reduce(
  (total, taskKey) => total + (taskEstimates[taskKey].minutes ?? 0),
  0
);

function getStableTaskKey(taskId: string) {
  return (Object.keys(taskEstimates) as StableTaskKey[]).find(
    (taskKey) => taskId === taskKey || taskId.endsWith(`-${taskKey}`)
  );
}

export function getTaskTimeEstimate(taskId: string, placement: EstimatePlacement) {
  const taskKey = getStableTaskKey(taskId);

  if (!taskKey) {
    return null;
  }

  const estimate: TaskEstimate = taskEstimates[taskKey];
  return placement === "next-action" ? estimate.nextActionLabel ?? null : estimate.taskLabel;
}

export function getPhaseTimeEstimate(phaseId: string) {
  if (phaseId === "phase-kickoff") {
    return "Meeting: 30-min session";
  }

  if (phaseId === "phase-tenant-setup") {
    return `Est. ${TENANT_SETUP_TOTAL_MINUTES} min`;
  }

  if (phaseId === "phase-app-review") {
    return `MSP submission: ~${taskEstimates["task-5"].minutes} min`;
  }

  if (phaseId === "phase-sso-rollout") {
    return "30 min per application";
  }

  if (phaseId === "phase-customer-rollout") {
    return `Initial preparation: ~${taskEstimates["task-9"].minutes} min`;
  }

  return null;
}
