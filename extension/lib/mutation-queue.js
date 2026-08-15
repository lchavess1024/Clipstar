import { StoreError, applyMutation } from "./store.js";

export function createMutationQueue({ load, save, apply = applyMutation }) {
  if (typeof load !== "function" || typeof save !== "function" || typeof apply !== "function") {
    throw new TypeError("A mutation queue requires load, save, and apply functions.");
  }

  let tail = Promise.resolve();

  function enqueue(mutation, expectedRevision) {
    const task = tail.then(async () => {
      const current = await load();
      if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
        const error = new StoreError(
          "Your collection changed in another Clipstar window. Review this form, then save again.",
          "CONFLICT"
        );
        error.currentRevision = current.revision;
        throw error;
      }
      return save(apply(current, mutation));
    });

    tail = task.then(() => undefined, () => undefined);
    return task;
  }

  return {
    enqueue,
    idle: () => tail
  };
}
