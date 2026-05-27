use soroban_sdk::{contracttype, Address, Bytes};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReviewAggregate {
    pub total_points: i128,
    pub reviews: u32,
    pub average_rating_bps: i32,
}

impl ReviewAggregate {
    pub fn new() -> Self {
        Self {
            total_points: 0,
            reviews: 0,
            average_rating_bps: 5_000,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct RoleMetrics {
    pub score: i32,
    pub completed_jobs: u32,
    pub review: ReviewAggregate,
    pub badge_level: u32,
}

impl RoleMetrics {
    pub fn new() -> Self {
        Self {
            score: 5_000,
            completed_jobs: 0,
            review: ReviewAggregate::new(),
            badge_level: 0,
        }
    }
}

/// Badge tier awarded based on cumulative score thresholds.
/// Scores are in basis points (0–10 000).
///
/// Thresholds:
///   Bronze  ≥ 4 000
///   Silver  ≥ 6 000
///   Gold    ≥ 8 000
///   Platinum ≥ 9 500
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BadgeLevel {
    None,
    Bronze,
    Silver,
    Gold,
    Platinum,
}

impl BadgeLevel {
    pub fn from_score(score: i32) -> Self {
        match score {
            s if s >= 9_500 => BadgeLevel::Platinum,
            s if s >= 8_000 => BadgeLevel::Gold,
            s if s >= 6_000 => BadgeLevel::Silver,
            s if s >= 4_000 => BadgeLevel::Bronze,
            _ => BadgeLevel::None,
        }
    }
}

/// Badge tiers keyed in the metadata map.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BadgeTier {
    Bronze,
    Silver,
    Gold,
    Platinum,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BadgeMetadataEntry {
    pub tier: BadgeTier,
    /// IPFS CID (or any URI) pointing to the badge image / JSON metadata.
    pub uri: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub address: Address,
    pub client: RoleMetrics,
    pub freelancer: RoleMetrics,
    pub is_blacklisted: bool,
    pub metadata_hash: Option<Bytes>,
    /// Per-tier badge metadata URIs set by the admin.
    pub badge_metadata: soroban_sdk::Vec<BadgeMetadataEntry>,
}

impl Profile {
    pub fn new(address: Address) -> Self {
        Self {
            address,
            client: RoleMetrics::new(),
            freelancer: RoleMetrics::new(),
            is_blacklisted: false,
            metadata_hash: None,
            badge_metadata: soroban_sdk::Vec::new(_env),
        }
    }
}
