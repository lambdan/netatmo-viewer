declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}

/** Version of this build, from vite.config.ts. */
declare const __APP_VERSION__: string;
