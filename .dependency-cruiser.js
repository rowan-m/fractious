/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "This dependency is part of a circular relationship. You might want to revise your solution (i.e. use dependency inversion, make sure the modules have a single responsibility) ",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "no-orphans",
      severity: "info",
      comment:
        "This is an orphan module - it's likely not used (anymore?). Either use it or remove it. If it's logical this module is an orphan (i.e. it's a html file), add an exception or just ignore it.",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "package\\.json",
          "tsconfig\\.json",
          "eslint\\.config\\.js",
          "vite\\.config\\.js",
        ],
      },
      to: {},
    },
    {
      name: "no-deprecated-core",
      severity: "warn",
      comment:
        "A module depends on a node core module that has been deprecated. Find an alternative.",
      from: {},
      to: {
        dependencyTypes: ["core"],
        path: [
          "^(v8/tools/codemap)$",
          "^(v8/tools/consarray)$",
          "^(v8/tools/csvparser)$",
          "^(v8/tools/logreader)$",
          "^(v8/tools/profile_view)$",
          "^(v8/tools/profile)$",
          "^(v8/tools/SourceMap)$",
          "^(v8/tools/splaytree)$",
          "^(v8/tools/tickprocessor-driver)$",
          "^(v8/tools/tickprocessor)$",
          "^(node-inspect/lib/_inspect)$",
          "^(node-inspect/lib/internal/inspect_client)$",
          "^(node-inspect/lib/internal/inspect_repl)$",
          "^(async_hooks)$",
          "^(punycode)$",
          "^(domain)$",
          "^(constants)$",
          "^(sys)$",
          "^_linklist",
          "^_stream_wrap",
        ],
      },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment:
        "This module depends on a module that cannot be found ('resolved').",
      from: {},
      to: {
        couldNotResolve: true,
        pathNot: ["^\\?raw$"], // Allow vite ?raw imports
      },
    },
    {
      name: "not-to-test",
      severity: "error",
      comment:
        "This module depends on code within a test folder or file. This indicates a test-only utility is leaking into production code.",
      from: {
        pathNot:
          "\\.(spec|test)\\.(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee\\.md)$",
      },
      to: {
        path: "\\.(spec|test)\\.(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee\\.md)$",
      },
    },
    {
      name: "worker-isolation",
      severity: "error",
      comment:
        "Web workers must not import DOM-dependent UI or Renderer modules.",
      from: { path: "^src/worker\\.js$" },
      to: { path: "^src/(Renderer|InteractionManager|main)\\.js$" },
    },
    {
      name: "no-dev-dependencies",
      severity: "error",
      comment: "Don't import devDependencies from production code.",
      from: {
        path: "^src/",
        pathNot:
          "\\.(spec|test)\\.(js|mjs|cjs|ts|ls|coffee|litcoffee|coffee\\.md)$",
      },
      to: { dependencyTypes: ["npm-dev"] },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
      archi: {
        collapsePattern: "^(packages|src|lib|app|bin|test(s?)|spec(s?))/[^/]+",
      },
    },
  },
};
