/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Keep native / ESM-only packages out of webpack bundling
  serverExternalPackages: ["neo4j-driver", "@huggingface/transformers", "onnxruntime-node"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Force neo4j-driver (and its protobuf/native deps) to remain external
      const existingExternals = config.externals ?? [];
      const extraExternals = ({ request }, callback) => {
        if (
          request === "neo4j-driver" || request?.startsWith("neo4j-driver/") ||
          request === "@huggingface/transformers" || request?.startsWith("@huggingface/") ||
          request === "onnxruntime-node" || request?.startsWith("onnxruntime-node/")
        ) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      };
      config.externals = Array.isArray(existingExternals)
        ? [...existingExternals, extraExternals]
        : [existingExternals, extraExternals];
    } else {
      // Don't bundle server-only modules on the client side
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
      };
    }
    return config;
  },
}

export default nextConfig