import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      // 代理路径
      "/path": {
        target: "http://example.com", // 目标服务器地址
        changeOrigin: true, // 允许跨域
        // rewrite: (path) => path.replace(/^\/api/, ""), // 可选：重写路径
      },
    },
  },
});
