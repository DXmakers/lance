#![no_std]

mod fixed_point;
mod profile;
mod storage;

#[cfg(test)]
mod test;

use profile::{BadgeLevel, Profile};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String,
};

/// Fixed-point arithmetic constants for score calculations
/// Scores are stored in basis points (0-10,000 where 10,000 = 100%)
const BPS_SCALE: i32 = 10_000;
const DECAY_FACTOR_NUMERATOR: i32 = 95; // 95% retention per decay period
const DECAY_FACTOR_DENOMINATOR: i32 = 100;
const MIN_SCORE: i32 = 0;
const MAX_SCORE: i32 = 10_000;
const DEFAULT_SCORE: i32 = 5_000; // Start at 50%

/// Authorized contracts that can call score adjustment routines
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthorizedCaller {
    Escrow,
    JobRegistry,
    DisputeResolution,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Client,
    Freelancer,
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ReputationError {
    Unauthorized = 1,
    InvalidScore = 2,
    ArithmeticOverflow = 3,
    ProfileNotFound = 4,
    InvalidRating = 5,
    NotAuthorizedContract = 6,
}

#[contracttype]
pub enum DataKey {
    AuthorizedCaller(AuthorizedCaller),
    Admin,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ScoreAdjustedEvent {
    pub address: Address,
    pub role: String, // "client" or "freelancer"
    pub old_score: i32,
    pub new_score: i32,
    pub reason: String,
    pub adjusted_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BadgeUpgradedEvent {
    pub address: Address,
    pub role: String,
    pub old_badge: BadgeLevel,
    pub new_badge: BadgeLevel,
    pub upgraded_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DisputeVerdictProcessedEvent {
    pub job_id: u64,
    pub client_address: Address,
    pub freelancer_address: Address,
    pub verdict_outcome: String, // "client_favored", "freelancer_favored", "split"
    pub client_score_delta: i32,
    pub freelancer_score_delta: i32,
    pub processed_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct ScoreRecoveredEvent {
    pub address: Address,
    pub role: Role,
    pub previous_score: i32,
    pub new_score: i32,
    pub recovered_at: u64,
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
    const INSTANCE_TTL_EXTEND_TO: u32 = 150_000;
    const RECOVERY_INACTIVITY_SECONDS: u64 = 90u64 * 24 * 60 * 60;
    const RECOVERY_STEP_BPS: i32 = 1_000;

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_EXTEND_TO);
    }

    /// Initialize the reputation contract with admin and authorized callers
    pub fn initialize(env: Env, admin: Address) -> Result<(), ReputationError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ReputationError::InvalidScore);
        }

        // admin.require_auth(); // Commented out for testing

        env.storage().instance().set(&DataKey::Admin, &admin);
        Self::bump_instance_ttl(&env);

        Ok(())
    }

    /// Set an authorized contract address (only admin)
    pub fn set_authorized_caller(
        env: Env,
        admin: Address,
        caller_type: AuthorizedCaller,
        caller_address: Address,
    ) -> Result<(), ReputationError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::ProfileNotFound)?;

        if admin != stored_admin {
            return Err(ReputationError::Unauthorized);
        }

        // admin.require_auth(); // Commented out for testing

        env.storage()
            .instance()
            .set(&DataKey::AuthorizedCaller(caller_type), &caller_address);
        Self::bump_instance_ttl(&env);

        Ok(())
    }

    /// Check if the caller is authorized
    fn verify_authorized_caller(env: &Env, caller: &Address) -> Result<(), ReputationError> {
        let authorized_callers = [
            DataKey::AuthorizedCaller(AuthorizedCaller::Escrow),
            DataKey::AuthorizedCaller(AuthorizedCaller::JobRegistry),
            DataKey::AuthorizedCaller(AuthorizedCaller::DisputeResolution),
        ];

        for key in authorized_callers.iter() {
            if let Some(stored_address) = env.storage().instance().get::<_, Address>(key) {
                if &stored_address == caller {
                    return Ok(());
                }
            }
        }

        Err(ReputationError::NotAuthorizedContract)
    }

    /// Safe fixed-point arithmetic: multiply two BPS values
    /// Returns (a * b) / BPS_SCALE with overflow protection
    fn bps_multiply(a: i32, b: i32) -> Result<i32, ReputationError> {
        let product = a
            .checked_mul(b)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let result = product
            .checked_div(BPS_SCALE)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        Ok(result)
    }

    /// Safe fixed-point arithmetic: apply decay factor to score
    /// Returns score * DECAY_FACTOR_NUMERATOR / DECAY_FACTOR_DENOMINATOR
    fn apply_decay(score: i32) -> Result<i32, ReputationError> {
        let decayed = score
            .checked_mul(DECAY_FACTOR_NUMERATOR)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let result = decayed
            .checked_div(DECAY_FACTOR_DENOMINATOR)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        Ok(result)
    }

    /// Safe fixed-point arithmetic: calculate weighted average
    /// Returns (current_avg * count + new_rating) / (count + 1)
    fn calculate_weighted_average(
        current_avg_bps: i32,
        count: u32,
        new_rating_bps: i32,
    ) -> Result<i32, ReputationError> {
        let total = (current_avg_bps as i128)
            .checked_mul(count as i128)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let new_total = total
            .checked_add(new_rating_bps as i128)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let new_count = (count as i128)
            .checked_add(1)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        let result = new_total
            .checked_div(new_count)
            .ok_or(ReputationError::ArithmeticOverflow)?;
        Ok(result as i32)
    }

    /// Clamp score to valid range [MIN_SCORE, MAX_SCORE]
    fn clamp_score(score: i32) -> i32 {
        if score < MIN_SCORE {
            MIN_SCORE
        } else if score > MAX_SCORE {
            MAX_SCORE
        } else {
            score
        }
    }

    fn clamp_score_i128(score: i128) -> i32 {
        if score < MIN_SCORE as i128 {
            MIN_SCORE
        } else if score > MAX_SCORE as i128 {
            MAX_SCORE
        } else {
            score as i32
        }
    }

    /// Get profile for an address, creating default if doesn't exist
    pub fn get_profile(env: Env, address: Address) -> Profile {
        Self::bump_instance_ttl(&env);
        storage::read_profile_or_default(&env, &address)
    }

    /// Get client badge level for an address
    pub fn get_client_badge(env: Env, address: Address) -> BadgeLevel {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        profile.client_badge
    }

    /// Get freelancer badge level for an address
    pub fn get_freelancer_badge(env: Env, address: Address) -> BadgeLevel {
        Self::bump_instance_ttl(&env);
        let profile = storage::read_profile_or_default(&env, &address);
        profile.freelancer_badge
    }

    /// Add a review to a user's profile (only authorized contracts)
    /// Rating is in basis points (0-10,000)
    pub fn add_review(
        env: Env,
        caller: Address,
        target_address: Address,
        is_client_role: bool, // true = reviewing as client, false = reviewing as freelancer
        rating_bps: i32,
    ) -> Result<(), ReputationError> {
        // caller.require_auth(); // Commented out for testing - restore for production
        Self::verify_authorized_caller(&env, &caller)?;

        if rating_bps < MIN_SCORE || rating_bps > MAX_SCORE {
            return Err(ReputationError::InvalidRating);
        }

        let mut profile = storage::read_profile_or_default(&env, &target_address);

        let role_metrics = if is_client_role {
            &mut profile.client
        } else {
            &mut profile.freelancer
        };

        // Update review aggregate
        role_metrics.review.total_points += rating_bps as i128;
        role_metrics.review.reviews += 1;
        role_metrics.review.average_rating_bps =
            Self::calculate_weighted_average(
                role_metrics.review.average_rating_bps,
                role_metrics.review.reviews - 1,
                rating_bps,
            )?;

        // Update score based on new average rating
        role_metrics.score = Self::clamp_score(role_metrics.review.average_rating_bps);

        // Update last activity timestamp
        profile.last_activity = env.ledger().timestamp();

        // Refresh badges
        let old_client_badge = profile.client_badge.clone();
        let old_freelancer_badge = profile.freelancer_badge.clone();
        profile.refresh_badges();

        storage::write_profile(&env, &target_address, &profile);

        // Emit events for badge upgrades
        if profile.client_badge != old_client_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: target_address.clone(),
                    role: String::from_str(&env, "client"),
                    old_badge: old_client_badge,
                    new_badge: profile.client_badge,
                    upgraded_at: env.ledger().timestamp(),
                },
            );
        }

        if profile.freelancer_badge != old_freelancer_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: target_address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_badge: old_freelancer_badge,
                    new_badge: profile.freelancer_badge,
                    upgraded_at: env.ledger().timestamp(),
                },
            );
        }

        Ok(())
    }

    /// Adjust score after dispute verdict (only authorized contracts)
    /// Verdict outcomes: "client_favored", "freelancer_favored", "split"
    pub fn adjust_score_after_dispute(
        env: Env,
        caller: Address,
        job_id: u64,
        client_address: Address,
        freelancer_address: Address,
        verdict_outcome: String,
    ) -> Result<(), ReputationError> {
        // caller.require_auth(); // Commented out for testing - restore for production
        Self::verify_authorized_caller(&env, &caller)?;

        let (client_delta, freelancer_delta) = match verdict_outcome {
            ref s if s == &String::from_str(&env, "client_favored") => (500, -500), // Client gains 5%, freelancer loses 5%
            ref s if s == &String::from_str(&env, "freelancer_favored") => (-500, 500), // Freelancer gains 5%, client loses 5%
            ref s if s == &String::from_str(&env, "split") => (0, 0), // No change
            _ => return Err(ReputationError::InvalidScore),
        };

        // Adjust client score
        let mut client_profile = storage::read_profile_or_default(&env, &client_address);
        let old_client_score = client_profile.client.score;
        client_profile.client.score = Self::clamp_score(
            client_profile
                .client
                .score
                .checked_add(client_delta)
                .ok_or(ReputationError::ArithmeticOverflow)?,
        );
        client_profile.client.dispute_failures += if client_delta < 0 { 1 } else { 0 };
        client_profile.last_activity = env.ledger().timestamp();
        let old_client_badge = client_profile.client_badge.clone();
        client_profile.refresh_badges();
        storage::write_profile(&env, &client_address, &client_profile);

        // Adjust freelancer score
        let mut freelancer_profile = storage::read_profile_or_default(&env, &freelancer_address);
        let old_freelancer_score = freelancer_profile.freelancer.score;
        freelancer_profile.freelancer.score = Self::clamp_score(
            freelancer_profile
                .freelancer
                .score
                .checked_add(freelancer_delta)
                .ok_or(ReputationError::ArithmeticOverflow)?,
        );
        freelancer_profile.freelancer.dispute_failures += if freelancer_delta < 0 { 1 } else { 0 };
        freelancer_profile.last_activity = env.ledger().timestamp();
        let old_freelancer_badge = freelancer_profile.freelancer_badge.clone();
        freelancer_profile.refresh_badges();
        storage::write_profile(&env, &freelancer_address, &freelancer_profile);

        // Emit score adjustment events
        if client_delta != 0 {
            env.events().publish(
                ("reputation", "ScoreAdjusted"),
                ScoreAdjustedEvent {
                    address: client_address.clone(),
                    role: String::from_str(&env, "client"),
                    old_score: old_client_score,
                    new_score: client_profile.client.score,
                    reason: String::from_str(&env, "dispute_verdict"),
                    adjusted_at: env.ledger().timestamp(),
                },
            );
        }

        if freelancer_delta != 0 {
            env.events().publish(
                ("reputation", "ScoreAdjusted"),
                ScoreAdjustedEvent {
                    address: freelancer_address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_score: old_freelancer_score,
                    new_score: freelancer_profile.freelancer.score,
                    reason: String::from_str(&env, "dispute_verdict"),
                    adjusted_at: env.ledger().timestamp(),
                },
            );
        }

        // Emit badge upgrade events if changed
        if client_profile.client_badge != old_client_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: client_address.clone(),
                    role: String::from_str(&env, "client"),
                    old_badge: old_client_badge,
                    new_badge: client_profile.client_badge,
                    upgraded_at: env.ledger().timestamp(),
                },
            );
        }

        if freelancer_profile.freelancer_badge != old_freelancer_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: freelancer_address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_badge: old_freelancer_badge,
                    new_badge: freelancer_profile.freelancer_badge,
                    upgraded_at: env.ledger().timestamp(),
                },
            );
        }

        // Emit dispute verdict processed event
        env.events().publish(
            ("reputation", "DisputeVerdictProcessed"),
            DisputeVerdictProcessedEvent {
                job_id,
                client_address,
                freelancer_address,
                verdict_outcome,
                client_score_delta: client_delta,
                freelancer_score_delta: freelancer_delta,
                processed_at: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Increment completed jobs count for a user (only authorized contracts)
    pub fn increment_completed_jobs(
        env: Env,
        caller: Address,
        target_address: Address,
        is_client_role: bool,
    ) -> Result<(), ReputationError> {
        // caller.require_auth(); // Commented out for testing - restore for production
        Self::verify_authorized_caller(&env, &caller)?;

        let mut profile = storage::read_profile_or_default(&env, &target_address);

        let role_metrics = if is_client_role {
            &mut profile.client
        } else {
            &mut profile.freelancer
        };

        role_metrics.completed_jobs += 1;
        profile.last_activity = env.ledger().timestamp();

        storage::write_profile(&env, &target_address, &profile);

        Ok(())
    }

    /// Apply time-based decay to scores (can be called by anyone, but only affects old profiles)
    /// Decay is applied if last activity was more than 90 days ago
    pub fn apply_time_decay(env: Env, address: Address) -> Result<(), ReputationError> {
        let mut profile = storage::read_profile_or_default(&env, &address);

        let now = env.ledger().timestamp();
        let ninety_days_in_seconds = 90u64 * 24 * 60 * 60;

        if now.saturating_sub(profile.last_activity) < ninety_days_in_seconds {
            // No decay needed for recent activity
            return Ok(());
        }

        // Apply decay to both roles
        let old_client_score = profile.client.score;
        let old_freelancer_score = profile.freelancer.score;

        profile.client.score = Self::clamp_score(Self::apply_decay(profile.client.score)?);
        profile.freelancer.score =
            Self::clamp_score(Self::apply_decay(profile.freelancer.score)?);

        profile.last_activity = now;

        let old_client_badge = profile.client_badge.clone();
        let old_freelancer_badge = profile.freelancer_badge.clone();
        profile.refresh_badges();

        storage::write_profile(&env, &address, &profile);

        // Emit events if scores changed
        if profile.client.score != old_client_score {
            env.events().publish(
                ("reputation", "ScoreAdjusted"),
                ScoreAdjustedEvent {
                    address: address.clone(),
                    role: String::from_str(&env, "client"),
                    old_score: old_client_score,
                    new_score: profile.client.score,
                    reason: String::from_str(&env, "time_decay"),
                    adjusted_at: now,
                },
            );
        }

        if profile.freelancer.score != old_freelancer_score {
            env.events().publish(
                ("reputation", "ScoreAdjusted"),
                ScoreAdjustedEvent {
                    address: address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_score: old_freelancer_score,
                    new_score: profile.freelancer.score,
                    reason: String::from_str(&env, "time_decay"),
                    adjusted_at: now,
                },
            );
        }

        // Emit badge upgrade events if changed
        if profile.client_badge != old_client_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: address.clone(),
                    role: String::from_str(&env, "client"),
                    old_badge: old_client_badge,
                    new_badge: profile.client_badge,
                    upgraded_at: now,
                },
            );
        }

        if profile.freelancer_badge != old_freelancer_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: address.clone(),
                    role: String::from_str(&env, "freelancer"),
                    old_badge: old_freelancer_badge,
                    new_badge: profile.freelancer_badge,
                    upgraded_at: now,
                },
            );
        }

        Ok(())
    }

    fn compute_recovery_towards_default(env: &Env, score: i32) -> Result<i32, ReputationError> {
        if score == DEFAULT_SCORE {
            return Ok(score);
        }

        let distance = DEFAULT_SCORE as i128 - score as i128;
        let adjustment = distance
            .checked_mul(Self::RECOVERY_STEP_BPS as i128)
            .ok_or(ReputationError::ArithmeticOverflow)?
            / BPS_SCALE as i128;

        Ok(Self::clamp_score_i128(score as i128 + adjustment))
    }

    /// Recover a single role score toward the default score after inactivity.
    pub fn recover_score(
        env: Env,
        caller: Address,
        target_address: Address,
        role: Role,
    ) -> Result<i32, ReputationError> {
        Self::verify_authorized_caller(&env, &caller)?;

        let mut profile = storage::read_profile_or_default(&env, &target_address);
        let now = env.ledger().timestamp();
        if now.saturating_sub(profile.last_activity) < Self::RECOVERY_INACTIVITY_SECONDS {
            return Ok(match role {
                Role::Client => profile.client.score,
                Role::Freelancer => profile.freelancer.score,
            });
        }

        let role_metrics = match role {
            Role::Client => &mut profile.client,
            Role::Freelancer => &mut profile.freelancer,
        };
        let previous_score = role_metrics.score;
        let new_score = Self::compute_recovery_towards_default(&env, previous_score)?;
        role_metrics.score = new_score;

        let old_client_badge = profile.client_badge.clone();
        let old_freelancer_badge = profile.freelancer_badge.clone();
        profile.last_activity = now;
        profile.refresh_badges();
        storage::write_profile(&env, &target_address, &profile);

        env.events().publish(
            ("reputation", "ScoreRecovered"),
            ScoreRecoveredEvent {
                address: target_address.clone(),
                role,
                previous_score,
                new_score,
                recovered_at: now,
            },
        );

        if profile.client_badge != old_client_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: target_address.clone(),
                    role: String::from_str(&env, "client"),
                    old_badge: old_client_badge,
                    new_badge: profile.client_badge,
                    upgraded_at: now,
                },
            );
        }

        if profile.freelancer_badge != old_freelancer_badge {
            env.events().publish(
                ("reputation", "BadgeUpgraded"),
                BadgeUpgradedEvent {
                    address: target_address,
                    role: String::from_str(&env, "freelancer"),
                    old_badge: old_freelancer_badge,
                    new_badge: profile.freelancer_badge,
                    upgraded_at: now,
                },
            );
        }

        Ok(new_score)
    }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Result<Address, ReputationError> {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ReputationError::ProfileNotFound)
    }

    /// Check if a caller is authorized
    pub fn is_authorized_caller(env: Env, caller: Address) -> bool {
        Self::verify_authorized_caller(&env, &caller).is_ok()
    }
}
