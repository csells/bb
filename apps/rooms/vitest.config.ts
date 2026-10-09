import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";
export default defineWorkspaceTestConfig({
  test: {
    projects: sharedWorkerProjects({
      pkgDir: import.meta.dirname,
      name: "@bb/rooms",
      include: ["test/*.test.ts"],
    }),
  },
});
