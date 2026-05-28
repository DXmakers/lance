use soroban_sdk::{contracttype, Address, Bytes, Env};

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
            badge_level: BadgeLevel::from_score(5_000).to_u32(),
        }
    }
}

/// Badge tier awarded based on cumulative score thresholds.
/// Scores are in basis points (0ΓÇô10 000).
///
/// Thresholds:
///   Bronze  ΓëÑ 4 000
///   Silver  ΓëÑ 6 000
///   Gold    ΓëÑ 8 000
///   Platinum ΓëÑ 9 500
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

    pub fn to_u32(&self) -> u32 {
        match self {
            BadgeLevel::None => 0,
            BadgeLevel::Bronze => 1,
            BadgeLevel::Silver => 2,
            BadgeLevel::Gold => 3,
            BadgeLevel::Platinum => 4,
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
    pub client_badge: BadgeLevel,
    pub freelancer_badge: BadgeLevel,
}

impl Profile {
    pub fn new(env: &soroban_sdk::Env, address: Address) -> Self {
        Self {
            address,
            client: RoleMetrics::new(),
            freelancer: RoleMetrics::new(),
            is_blacklisted: false,
            metadata_hash: None,
            badge_metadata: soroban_sdk::Vec::new(env),
        }
    }

    pub fn refresh_badges(&mut self) {
        let blacklisted = self.is_blacklisted;
        self.client.badge_level =
            if blacklisted { 0 } else { BadgeLevel::from_score(self.client.score).to_u32() };
        self.freelancer.badge_level =
            if blacklisted { 0 } else { BadgeLevel::from_score(self.freelancer.score).to_u32() };
    }
}
