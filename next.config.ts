import { withWorkflow } from 'workflow/next';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Cedar's Node build loads its WebAssembly from its own directory at runtime.
  serverExternalPackages: ['@cedar-policy/cedar-wasm'],
};

export default withWorkflow(nextConfig);
