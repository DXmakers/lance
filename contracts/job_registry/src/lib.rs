#388 [SC-REG-034] Job Registry and Proposal Scaling Validation - Step 34
Repo Avatar
DXmakers/lance
Implement Dynamic Service Fee Adjustments for Job Postings
Category: Smart Contract: Job Registry & Bidding
Task ID: SC-REG-034
Description
This issue is dedicated to the technical design, implementation, and rigorous auditing of 'Implement Dynamic Service Fee Adjustments for Job Postings' inside the Lance marketplace ecosystem, specifically focusing on the Smart Contract: Job Registry & Bidding component. As a Soroban smart contract task, the contributor must design robust instance or persistent storage allocations, ensure safe checked math operations, and write high-coverage unit tests within the Rust cargo test harness. The compiled WASM footprint must fit comfortably within standard block boundaries. Ensure that your implementation strictly adheres to the project's architectural guidelines, features self-documenting code with comprehensive inline annotations, and provides solid verification proofs. Any modifications to state variables must undergo strict validation before commits.

Requirements
Scaffold and write the contract logic in contracts/job_registry/src/lib.rs for Implement Dynamic Service Fee Adjustments for Job Postings.
Compress heavy text strings into compact IPFS Content Identifiers (CIDs) before storing on-chain.
Design clean mappings from Job IDs to dynamic bid structures utilizing map-like storage arrays.
Implement strict ownership validation so that only the job creator can accept proposals.
Acceptance Criteria
Contract successfully compiles and fits within the standard Soroban WASM size limits.
Registry state transitions cleanly to 'Assigned' once a bid is successfully accepted.
Out-of-bounds inputs or late bid submissions are gracefully blocked and return specific error codes.