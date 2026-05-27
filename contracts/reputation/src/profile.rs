use soroban_sdk::{contracttype, Address, Bytes, Env};

/// Badge levels representing cumulative reputation milestones.
///
/// Level 1 = Bronze  (default for all new accounts)
/// Level 2 = Silver  (awarded for sustained positive performance)
/// Level 3 = Gold    (awarded for exceptional platform contribution)
/// Level 4 = Platinum (reserved for elite long-term participants)
pub const BADGE_LEVEL_MIN: u32 = 1;
pub const BADGE_LEVEL_MAX: u32 = 4;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub address: Address,

    // ── Client-role fields ──────────────────────────────────────────────────
    pub client_score: i32,
    pub client_points: i32,
    pub client_jobs: u32,
    /// Total number of disputes opened against this address as a client.
    /// Each dispute applies a decay factor to the cumulative score.
    pub client_disputes: u32,
    /// Badge tier for this address in the client role (1–4).
    pub client_badge_level: u32,

    // ── Freelancer-role fields ──────────────────────────────────────────────
    pub freelancer_score: i32,
    pub freelancer_points: i32,
    pub freelancer_jobs: u32,
    /// Total number of disputes opened against this address as a freelancer.
    pub freelancer_disputes: u32,
    /// Badge tier for this address in the freelancer role (1–4).
    pub freelancer_badge_level: u32,

    pub metadata_hash: Option<Bytes>,
}

impl Profile {
    /// Create a fresh profile with neutral starting values.
    /// - Score starts at 5000 bps (50 %) — neither positive nor negative.
    /// - Disputes start at 0.
    /// - Badge level starts at 1 (Bronze).
    pub fn new(_env: &Env, address: Address) -> Self {
        Self {
            address,
            client_score: 5000,
            client_points: 0,
            client_jobs: 0,
            client_disputes: 0,
            client_badge_level: BADGE_LEVEL_MIN,
            freelancer_score: 5000,
            freelancer_points: 0,
            freelancer_jobs: 0,
            freelancer_disputes: 0,
            freelancer_badge_level: BADGE_LEVEL_MIN,
            metadata_hash: None,
        }
    }
}

