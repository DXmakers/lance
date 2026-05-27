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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub address: Address,
    pub client: RoleMetrics,
    pub freelancer: RoleMetrics,
    pub is_blacklisted: bool,
    pub metadata_hash: Option<Bytes>,
}

impl Profile {
    pub fn new(address: Address) -> Self {
        Self {
            address,
            client: RoleMetrics::new(),
            freelancer: RoleMetrics::new(),
            is_blacklisted: false,
            metadata_hash: None,
        }
    }
}
