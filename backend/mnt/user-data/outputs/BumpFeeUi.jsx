import { useState, useEffect, useRef } from "react";

const STEPS = [
  {
    id: "building",
    label: "Build",
    icon: "◈",
    desc: "Constructing XDR envelope with contract args",
  },
  {
    id: "simulating",
    label: "Simulate",
    icon: "◉",
    desc: "Estimating fees & resources via Soroban RPC",
  },
  {
    id: "awaiting_signature",
    label: "Sign",
    icon: "◎",
    desc: "Awaiting wallet signature (Freighter)",
  },
  {
    id: "submitting",
    label: "Submit",
    icon: "◐",
    desc: "Broadcasting to Testnet RPC endpoint",
  },
  {
    id: "polling",
    label: "Confirm",
    icon: "◑",
    desc: "Polling ledger for finality",
  },
];

const STEP_IDS = STEPS.map((s) => s.id);
const TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

const MOCK_XDR =
  "AAAAAgAAAABiXst4Ue0AAAAABQAAAAAAAAAC/////gAAAAEAAAABAAAAAgAAAA8AAAAHYnVtcF9mZWUAAAAAAAACAAAAEgAAAAGkE9G3rHk2G5JCk3a+Ww+TfXgYh5p0FY/uaYAAAACAAAAAAAAAAA7msoAAAAAAAAAAQAAAAAAAAAAAAAA";
const MOCK_HASH =
  "6bc97b01e2e9a832b4a0a7e5d4a1234567890abcdef1234567890abcdef123456";
const MOCK_RESULT_XDR = "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=";

function truncate(str, front = 12, back = 8) {
  if (!str || str.length <= front + back + 3) return str;
  return `${str.slice(0, front)}...${str.slice(-back)}`;
}

function PulsingRing({ active }) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {active && (
        <>
          <span
            style={{
              position: "absolute",
              borderRadius: "50%",
              width: 32,
              height: 32,
              border: "1.5px solid #1a9e6e",
              animation: "pingRing 1.4s ease-out infinite",
              opacity: 0,
            }}
          />
          <span
            style={{
              position: "absolute",
              borderRadius: "50%",
              width: 32,
              height: 32,
              border: "1.5px solid #1a9e6e",
              animation: "pingRing 1.4s ease-out 0.5s infinite",
              opacity: 0,
            }}
          />
        </>
      )}
    </span>
  );
}

function StepNode({ step, state, isLast }) {
  const isActive = state === "active";
  const isDone = state === "done";
  const isError = state === "error";

  const dotColor = isDone
    ? "#1a9e6e"
    : isError
      ? "#c0392b"
      : isActive
        ? "#1a9e6e"
        : "#3a3a3a";
  const labelColor = isActive
    ? "#e8f5f0"
    : isDone
      ? "#a3d9c5"
      : isError
        ? "#f5a49a"
        : "#555";
  const descColor = isActive ? "#7abfa5" : isDone ? "#6aad90" : "#444";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        flex: 1,
        minWidth: 0,
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: isDone ? "#0d3d2a" : isActive ? "#0d3d2a" : "#1a1a1a",
            border: `1.5px solid ${dotColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            color: dotColor,
            position: "relative",
            transition: "border-color 0.3s, color 0.3s",
          }}
        >
          {isDone ? "✓" : isError ? "✕" : step.icon}
          {isActive && <PulsingRing active />}
        </div>
        {!isLast && (
          <div
            style={{
              width: 1,
              height: 40,
              marginTop: 4,
              background: isDone ? "#1a9e6e" : "#2a2a2a",
              transition: "background 0.4s",
            }}
          />
        )}
      </div>
      <div style={{ paddingTop: 6, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            fontWeight: 600,
            color: labelColor,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            transition: "color 0.3s",
          }}
        >
          {step.label}
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 10,
            color: descColor,
            marginTop: 2,
            lineHeight: 1.5,
          }}
        >
          {step.desc}
        </div>
      </div>
    </div>
  );
}

function XdrBox({ label, value, copyable = true }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: "#4a7a64",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        {copyable && (
          <button
            onClick={handleCopy}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              color: copied ? "#1a9e6e" : "#555",
              padding: "2px 6px",
              borderRadius: 3,
              transition: "color 0.2s",
            }}
          >
            {copied ? "copied ✓" : "copy"}
          </button>
        )}
      </div>
      <div
        style={{
          background: "#0a0f0c",
          border: "1px solid #1d3028",
          borderRadius: 4,
          padding: "8px 10px",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 10,
          color: "#6be0a8",
          wordBreak: "break-all",
          lineHeight: 1.7,
          letterSpacing: "0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function FeeDisplay({ base, resource, padding, total }) {
  const rows = [
    { label: "base fee", val: base, unit: "stroops" },
    { label: "min resource fee", val: resource, unit: "stroops" },
    { label: "padding", val: `+${padding}`, unit: "stroops" },
    { label: "total fee", val: total, unit: "stroops", highlight: true },
  ];
  return (
    <div
      style={{
        background: "#080d0a",
        border: "1px solid #1d3028",
        borderRadius: 4,
        overflow: "hidden",
        marginBottom: 12,
      }}
    >
      {rows.map((r, i) => (
        <div
          key={r.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 10px",
            borderBottom: i < rows.length - 1 ? "1px solid #111d16" : "none",
            background: r.highlight ? "#0d2419" : "transparent",
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9,
              color: "#4a7a64",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {r.label}
          </span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: r.highlight ? "#1a9e6e" : "#8ae0b8",
            }}
          >
            {r.val}{" "}
            <span style={{ color: "#3a6050", fontSize: 9 }}>{r.unit}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function ProgressBar({ progress }) {
  return (
    <div
      style={{
        height: 2,
        background: "#151e19",
        borderRadius: 2,
        overflow: "hidden",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background: "linear-gradient(90deg, #0d6e4a, #1a9e6e)",
          borderRadius: 2,
          transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      />
    </div>
  );
}

const DEMO_SEQUENCE = [
  { status: "building", delay: 800 },
  { status: "simulating", delay: 1600 },
  { status: "awaiting_signature", delay: 1400 },
  { status: "submitting", delay: 1000 },
  { status: "polling", delay: 2200 },
  { status: "success", delay: 0 },
];

export default function BumpFeeUI() {
  const [status, setStatus] = useState(null);
  const [simFee] = useState({
    base: 100,
    resource: 5000,
    padding: 10000,
    total: 15100,
  });
  const [txHash, setTxHash] = useState(null);
  const [resultXdr, setResultXdr] = useState(null);
  const [error, setError] = useState(null);
  const [formValues, setFormValues] = useState({
    contractId: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    functionName: "bump_fee",
    jobId: "job_0x0042",
    newFee: "500000",
    feePadding: "10000",
  });
  const timeouts = useRef([]);

  const activeStep = STEP_IDS.indexOf(status);
  const progress =
    status === "success"
      ? 100
      : status === "error"
        ? 100
        : status
          ? Math.round(((STEP_IDS.indexOf(status) + 1) / STEP_IDS.length) * 100)
          : 0;

  const getStepState = (stepId) => {
    if (status === "error" && stepId === STEP_IDS[Math.max(activeStep, 0)])
      return "error";
    if (status === "success") return "done";
    const si = STEP_IDS.indexOf(stepId);
    if (si < activeStep) return "done";
    if (si === activeStep) return "active";
    return "idle";
  };

  const runDemo = () => {
    setError(null);
    setTxHash(null);
    setResultXdr(null);
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
    let elapsed = 0;
    DEMO_SEQUENCE.forEach(({ status: s, delay }) => {
      elapsed += delay;
      const t = setTimeout(() => {
        setStatus(s);
        if (s === "polling" || s === "success") setTxHash(MOCK_HASH);
        if (s === "success") setResultXdr(MOCK_RESULT_XDR);
      }, elapsed);
      timeouts.current.push(t);
    });
  };

  const runError = () => {
    setError(null);
    setTxHash(null);
    setResultXdr(null);
    setStatus(null);
    timeouts.current.forEach(clearTimeout);
    setTimeout(() => setStatus("building"), 400);
    setTimeout(() => setStatus("simulating"), 1200);
    setTimeout(() => {
      setStatus("error");
      setError(
        "Simulation failed: contract trapped — insufficient escrow balance for bump_fee invocation",
      );
    }, 2400);
  };

  const reset = () => {
    timeouts.current.forEach(clearTimeout);
    setStatus(null);
    setTxHash(null);
    setResultXdr(null);
    setError(null);
  };

  const isRunning = status && status !== "success" && status !== "error";

  return (
    <div
      style={{
        background: "#060c09",
        minHeight: "100vh",
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
        color: "#c8e6d8",
        padding: 0,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600&display=swap');
        @keyframes pingRing {
          0% { transform: scale(0.85); opacity: 0.7; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; } 50% { opacity: 0.3; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; }
        input, select {
          background: #0a120d !important;
          border: 1px solid #1d3028 !important;
          color: #6be0a8 !important;
          border-radius: 4px !important;
          padding: 7px 10px !important;
          font-family: 'JetBrains Mono', monospace !important;
          font-size: 11px !important;
          outline: none !important;
          width: 100%;
        }
        input:focus { border-color: #1a9e6e !important; }
        .btn-primary {
          background: #0d3d2a; border: 1px solid #1a9e6e; color: #1a9e6e;
          padding: 9px 18px; border-radius: 4px; cursor: pointer;
          font-family: 'JetBrains Mono', monospace; font-size: 11px;
          letter-spacing: 0.08em; transition: background 0.2s, opacity 0.2s;
          text-transform: uppercase;
        }
        .btn-primary:hover:not(:disabled) { background: #0f4d35; }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-ghost {
          background: none; border: 1px solid #2a3d34; color: #4a7a64;
          padding: 9px 18px; border-radius: 4px; cursor: pointer;
          font-family: 'JetBrains Mono', monospace; font-size: 11px;
          letter-spacing: 0.08em; transition: background 0.2s;
          text-transform: uppercase;
        }
        .btn-ghost:hover { background: #0d1f16; }
        .btn-danger {
          background: none; border: 1px solid #5c1d1d; color: #c05050;
          padding: 9px 18px; border-radius: 4px; cursor: pointer;
          font-family: 'JetBrains Mono', monospace; font-size: 11px;
          letter-spacing: 0.08em; transition: background 0.2s;
          text-transform: uppercase;
        }
        .btn-danger:hover { background: #1a0a0a; }
        ::-webkit-scrollbar { width: 4px; } 
        ::-webkit-scrollbar-track { background: #0a0f0c; }
        ::-webkit-scrollbar-thumb { background: #1d3028; border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid #111d16",
          padding: "16px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "#0d3d2a",
              border: "1px solid #1a9e6e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              color: "#1a9e6e",
            }}
          >
            ◈
          </div>
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#c8e6d8",
                letterSpacing: "0.06em",
              }}
            >
              LANCE
            </div>
            <div
              style={{ fontSize: 9, color: "#3a6050", letterSpacing: "0.12em" }}
            >
              ESCROW PROTOCOL · STELLAR TESTNET
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: 9,
            color: "#1a9e6e",
            letterSpacing: "0.12em",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#1a9e6e",
              display: "inline-block",
              animation: "blink 2s ease-in-out infinite",
            }}
          />
          CONNECTED · FREIGHTER
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px 1fr",
          gap: 0,
          minHeight: "calc(100vh - 61px)",
        }}
      >
        {/* Left panel — form */}
        <div
          style={{
            borderRight: "1px solid #111d16",
            padding: "24px 20px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "#3a6050",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              marginBottom: 18,
            }}
          >
            Transaction Parameters
          </div>

          {[
            { label: "contract id", key: "contractId", placeholder: "C…" },
            {
              label: "function name",
              key: "functionName",
              placeholder: "bump_fee",
            },
            { label: "job id (arg[0])", key: "jobId", placeholder: "job_0x…" },
            {
              label: "new fee amount (arg[1])",
              key: "newFee",
              placeholder: "stroops",
            },
            {
              label: "fee padding (stroops)",
              key: "feePadding",
              placeholder: "10000",
            },
          ].map(({ label, key, placeholder }) => (
            <div key={key} style={{ marginBottom: 14 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 9,
                  color: "#3a6050",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: 5,
                }}
              >
                {label}
              </label>
              <input
                value={formValues[key]}
                onChange={(e) =>
                  setFormValues((v) => ({ ...v, [key]: e.target.value }))
                }
                placeholder={placeholder}
                disabled={isRunning}
              />
            </div>
          ))}

          <div
            style={{
              marginTop: 22,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <button
              className="btn-primary"
              onClick={runDemo}
              disabled={isRunning}
            >
              {isRunning ? "◉ executing…" : "◈ execute bump_fee"}
            </button>
            <button
              className="btn-danger"
              onClick={runError}
              disabled={isRunning}
            >
              ⚡ simulate error
            </button>
            {(status === "success" || status === "error") && (
              <button className="btn-ghost" onClick={reset}>
                ↩ reset
              </button>
            )}
          </div>

          {/* Fee summary */}
          {(status === "simulating" ||
            (status && STEP_IDS.indexOf(status) > 1)) && (
            <div style={{ marginTop: 24, animation: "slideIn 0.3s ease" }}>
              <div
                style={{
                  fontSize: 9,
                  color: "#3a6050",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Fee Analysis
              </div>
              <FeeDisplay {...simFee} />
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{ padding: "24px 28px", overflowY: "auto" }}>
          {/* Page title */}
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: "#c8e6d8",
                letterSpacing: "0.03em",
                marginBottom: 4,
              }}
            >
              Bump Fee
            </div>
            <div style={{ fontSize: 10, color: "#3a6050" }}>
              Soroban contract invocation · bump_fee(job_id, new_fee_amount)
            </div>
          </div>

          {/* Progress bar */}
          <ProgressBar progress={progress} />

          {/* Step tracker */}
          <div style={{ marginBottom: 28 }}>
            {STEPS.map((step, i) => (
              <StepNode
                key={step.id}
                step={step}
                state={status ? getStepState(step.id) : "idle"}
                isLast={i === STEPS.length - 1}
              />
            ))}
          </div>

          {/* XDR display — shown once we're past building */}
          {status && STEP_IDS.indexOf(status) >= 0 && (
            <div style={{ animation: "slideIn 0.35s ease" }}>
              <div
                style={{
                  fontSize: 9,
                  color: "#3a6050",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Transaction Envelope
              </div>
              <XdrBox label="built xdr" value={MOCK_XDR} />
            </div>
          )}

          {/* Polling indicator */}
          {status === "polling" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "#080d0a",
                border: "1px solid #1d3028",
                borderRadius: 4,
                marginBottom: 14,
                animation: "slideIn 0.3s ease",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#1a9e6e",
                  animation: "blink 0.9s ease-in-out infinite",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: "#4a7a64",
                }}
              >
                awaiting ledger confirmation · polling rpc every 2s
              </span>
            </div>
          )}

          {/* Success state */}
          {status === "success" && txHash && (
            <div
              style={{
                background: "#050f09",
                border: "1px solid #1a5c3a",
                borderRadius: 6,
                padding: "16px 18px",
                animation: "slideIn 0.4s ease",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#0d3d2a",
                    border: "1px solid #1a9e6e",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    color: "#1a9e6e",
                    flexShrink: 0,
                  }}
                >
                  ✓
                </span>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11,
                    color: "#1a9e6e",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Transaction Confirmed
                </span>
              </div>
              <XdrBox label="tx hash" value={txHash} />
              <XdrBox label="result xdr" value={resultXdr} />
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <a
                  href={`${TESTNET_EXPLORER}${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 14px",
                    background: "#0d2419",
                    border: "1px solid #1a5c3a",
                    borderRadius: 4,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: "#1a9e6e",
                    textDecoration: "none",
                    letterSpacing: "0.06em",
                    transition: "background 0.2s",
                  }}
                >
                  ↗ stellar.expert
                </a>
                <a
                  href={`https://testnet.steexp.com/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 14px",
                    background: "#0d1a24",
                    border: "1px solid #1a3d5c",
                    borderRadius: 4,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: "#4a9eba",
                    textDecoration: "none",
                    letterSpacing: "0.06em",
                    transition: "background 0.2s",
                  }}
                >
                  ↗ steexp.com
                </a>
              </div>
            </div>
          )}

          {/* Error state */}
          {status === "error" && error && (
            <div
              style={{
                background: "#0d0505",
                border: "1px solid #5c1d1d",
                borderRadius: 6,
                padding: "16px 18px",
                animation: "slideIn 0.35s ease",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#2a0a0a",
                    border: "1px solid #c05050",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    color: "#c05050",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  ✕
                </span>
                <div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      color: "#c05050",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    Transaction Failed
                  </div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: "#7a3535",
                      lineHeight: 1.7,
                    }}
                  >
                    {error}
                  </div>
                </div>
              </div>
              <div style={{ borderTop: "1px solid #2a1010", paddingTop: 12 }}>
                <div
                  style={{
                    fontSize: 9,
                    color: "#5c2020",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  Debugging resources
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <a
                    href="https://stellar.expert/explorer/testnet"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: "#c05050",
                      textDecoration: "none",
                    }}
                  >
                    ↗ stellar.expert
                  </a>
                  <span style={{ color: "#3a1a1a" }}>·</span>
                  <a
                    href="https://developers.stellar.org/docs/smart-contracts/errors"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: "#c05050",
                      textDecoration: "none",
                    }}
                  >
                    ↗ soroban error docs
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Idle state hint */}
          {!status && (
            <div
              style={{
                border: "1px dashed #111d16",
                borderRadius: 6,
                padding: "28px 20px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 11, color: "#2a4a38", marginBottom: 6 }}>
                ◈
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: "#2a4a38",
                }}
              >
                Configure parameters and execute to begin the transaction
                lifecycle
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
