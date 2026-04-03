import babel from "@babel/core";
import BabelPluginReactCompiler from "babel-plugin-react-compiler";

/** Configuration passed to the React compiler plugin invocation. */
const options = {};

/**
 * Bun plugin that pipes .js/.ts React files through Babel's React compiler.
 *
 * This keeps the rest of the toolchain on Bun while ensuring JSX/TSX inputs
 * are transformed with React compiler optimizations at load time.
 */
const reactCompiler: Bun.BunPlugin = {
  name: "react-compiler",
  /**
   * Register an onLoad hook for `.jsx` and `.tsx` files so Bun receives transformed
   * code before downstream compilation stages.
   */
  setup({ onLoad }) {
    onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
      // Load the source file at runtime so Babel always compiles the latest file contents.
      const input = await Bun.file(args.path).text();

      // Run Babel with React-compiler directly, avoiding config-file side effects.
      const result = await babel.transformAsync(input, {
        filename: args.path,
        plugins: [[BabelPluginReactCompiler, options]],
        parserOpts: { plugins: ["jsx", "typescript"] },
        ast: false,
        sourceMaps: false,
        configFile: false,
        babelrc: false,
      });

      // Fail fast if the transform pipeline did not emit code.
      if (result?.code == null) {
        throw new Error(`Failed to compile ${args.path}`);
      }

      return { contents: result.code, loader: "tsx" };
    });
  },
};

export default reactCompiler;
