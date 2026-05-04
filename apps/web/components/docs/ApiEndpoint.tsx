"use client";

import React from "react";
import { ApiEndpoint } from "../../lib/docs-api";

interface ApiEndpointProps {
  endpoint: ApiEndpoint;
}

/**
 * ApiEndpoint component for displaying detailed documentation of a single API route.
 * Follows Zinc-950 background with glassmorphism overlays and Emerald/Amber highlights.
 */
export const ApiEndpointCard: React.FC<ApiEndpointProps> = ({ endpoint }) => {
  const methodColor = {
    GET: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10",
    POST: "text-blue-400 border-blue-500/20 bg-blue-500/10",
    PUT: "text-amber-400 border-amber-500/20 bg-amber-500/10",
    DELETE: "text-red-400 border-red-500/20 bg-red-500/10",
    PATCH: "text-purple-400 border-purple-500/20 bg-purple-500/10",
  }[endpoint.method];

  return (
    <section 
      id={endpoint.id}
      className="mb-12 p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-md transition-all duration-150 hover:border-zinc-700 focus-within:ring-2 focus-within:ring-zinc-600 outline-none"
    >
      <div className="flex items-center gap-4 mb-4">
        <span className={`px-3 py-1 text-xs font-bold rounded-full border ${methodColor}`}>
          {endpoint.method}
        </span>
        <code className="text-zinc-400 text-sm font-mono">{endpoint.path}</code>
        {endpoint.status !== "stable" && (
          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
            endpoint.status === "beta" ? "text-amber-500 border-amber-500/30" : "text-zinc-500 border-zinc-500/30"
          }`}>
            {endpoint.status}
          </span>
        )}
      </div>

      <h2 className="text-xl font-semibold text-zinc-100 mb-2">{endpoint.title}</h2>
      <p className="text-zinc-400 text-sm mb-6 leading-relaxed">{endpoint.description}</p>

      {endpoint.params && endpoint.params.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Parameters</h3>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-800/50 text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Required</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-300">
                {endpoint.params.map((param) => (
                  <tr key={param.name}>
                    <td className="px-4 py-2 font-mono text-emerald-400">{param.name}</td>
                    <td className="px-4 py-2 text-zinc-500">{param.type}</td>
                    <td className="px-4 py-2">
                      <span className={param.required ? "text-amber-500" : "text-zinc-600"}>
                        {param.required ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-zinc-400">{param.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {endpoint.requestBody && (
        <div className="mb-6">
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Request Body</h3>
          <pre className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 overflow-x-auto">
            <code className="text-sm font-mono text-zinc-300">
              {JSON.stringify(endpoint.requestBody, null, 2)}
            </code>
          </pre>
        </div>
      )}

      {endpoint.response && (
        <div>
          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Response</h3>
          <pre className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 overflow-x-auto">
            <code className="text-sm font-mono text-emerald-300">
              {JSON.stringify(endpoint.response, null, 2)}
            </code>
          </pre>
        </div>
      )}
    </section>
  );
};
