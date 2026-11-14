import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { Prisma } from "../generated/prisma/client.js";

// Seeding is a one-off CLI write, so prefer the direct/session Neon connection
// that Prisma migrations use. Both DIRECT_URL and DATABASE_URL are required and
// are validated against the approved development host by the guard below.
const seedConnectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!seedConnectionString) {
  throw new Error("DIRECT_URL and DATABASE_URL must both be defined before running the seed.");
}
const usingDirectConnection = Boolean(process.env.DIRECT_URL);

// Development-only seed safety. This seed may only write to the approved
// development Neon host, and both configured URLs must resolve to it. Error
// messages deliberately never include connection strings, hostnames, or
// credentials.
const APPROVED_SEED_HOSTS = new Set([
  "ep-shy-glade-a1uvm947.ap-southeast-1.aws.neon.tech",
  "ep-shy-glade-a1uvm947-pooler.ap-southeast-1.aws.neon.tech",
]);

function assertApprovedHostname(
  label: "DIRECT_URL" | "DATABASE_URL",
  value: string | undefined,
): void {
  if (!value) {
    throw new Error(
      `Refusing to seed: ${label} is not set. Both DIRECT_URL and DATABASE_URL must be defined and point at the approved development Neon host.`,
    );
  }

  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    throw new Error(`Refusing to seed: ${label} could not be parsed as a database URL.`);
  }

  if (!APPROVED_SEED_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing to seed: ${label} does not point at the approved development Neon host.`,
    );
  }
}

function assertDevelopmentSeedTarget(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to seed: NODE_ENV=production is not allowed. This seed is development-only.",
    );
  }

  const target = process.env.SEED_TARGET?.trim();
  if (target !== "development") {
    throw new Error(
      'Refusing to seed: SEED_TARGET must be set to exactly "development". Missing, production, and unexpected targets are not allowed.',
    );
  }

  assertApprovedHostname("DIRECT_URL", process.env.DIRECT_URL);
  assertApprovedHostname("DATABASE_URL", process.env.DATABASE_URL);
}

const seedPrisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: seedConnectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  }),
});

/*
 * Idempotent starter seed for Fixit knowledge-base records.
 *
 * This file intentionally creates every knowledge row as UNREVIEWED. Nothing here
 * may approve a record: approval is a separate, deliberate review action. The seed
 * also refuses to overwrite a human-edited review status or a conflicting meaning.
 */

type Category = "WASHING_MACHINE" | "REFRIGERATOR";
type SafetyClass = "USER_SAFE" | "TECHNICIAN_ONLY";
type Difficulty = "EASY" | "MODERATE" | "HARD";
type ModelScope =
  | "UNSPECIFIED"
  | "TOP_LOAD"
  | "FRONT_LOAD"
  | "FRENCH_DOOR_BOTTOM_FREEZER";
type SeedSourceKind = "MANUAL" | "MANUFACTURER_PAGE";

const CAPTURED_AT = new Date("2026-11-14T00:00:00.000Z");
const ACCESSED_LABEL = "Official manufacturer support page; accessed 2026-11-14";

type SourceSeed = {
  title: string;
  kind: SeedSourceKind;
  url: string;
  edition: string;
  capturedAt: Date;
};

// Source keys are local constants, not database UUIDs. The seed looks existing
// sources up by title + URL and only creates them when absent.
const SOURCES = {
  samsung_washer_uk: {
    title: "Samsung -- Washing machine information codes",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.samsung.com/uk/support/home-appliances/check-out-the-information-codes-on-my-washing-machine/",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  samsung_washer_pk: {
    title: "Samsung Pakistan -- 4C/4E/NF/NF1 water supply troubleshooting",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.samsung.com/pk/support/home-appliances/resolve-4c-4e-nf-or-nf1-error-codes-on-your-samsung-washing-machine/",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  lg_washer_topload: {
    title: "LG -- Top Load Washer Error Code List",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.lg.com/us/support/help-library/lg-top-load-washer-error-code-list-CT10000010-20154403824104",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  whirlpool_washer_frontload: {
    title: "Whirlpool -- Error Codes in Front Load Washers",
    kind: "MANUFACTURER_PAGE",
    url: "https://producthelp.whirlpool.com/Laundry/Washers/Product_Info/Washer_Product_Assistance/Error_Codes_in_Front_Load_Washers",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  bosch_washer_errors: {
    title: "Bosch -- Washer error codes",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.bosch-home.com/us/en/c/spotlight/blt341dacb48f00c362/owner-support/error-codes/washers",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  bosch_washer_manual: {
    title: "Bosch -- Use and Care Manual (washer error messages)",
    // This source is the actual manufacturer-hosted appliance manual, not a
    // manufacturer support page.
    kind: "MANUAL",
    url: "https://media3.bosch-home.com/Documents/9000825639_D.pdf",
    edition: "Manufacturer use-and-care manual (9000825639_D.pdf); accessed 2026-11-14",
    capturedAt: CAPTURED_AT,
  },
  haier_washer_topload: {
    title: "Haier India -- Top Load Washing Machine Troubleshooting",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.haier.com/in/service-support/self-service/20240828_249143.shtml",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  haier_washer_e4_pk: {
    title: "Haier Pakistan -- Washing Machine E4 Water Inlet Failure",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.haier.com/pk/service-support/self-service/20261023_295891.shtml",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  haier_washer_e1_pk: {
    title: "Haier Pakistan -- Washing Machine E1 Drainage Error",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.haier.com/pk/service-support/self-service/20261016_295632.shtml",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  samsung_fridge_us: {
    title: "Samsung -- Refrigerator Error Codes",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.samsung.com/us/support/troubleshoot/TSG10007315/",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  lg_fridge_us_ff: {
    title: "LG -- Er FF / E FF / F Refrigerator Error Code",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.lg.com/us/support/help-library/if-you-see-an-er-ff-e-ff-or-f-error-code-on-your-lg-refrigerator--20155452969338",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  lg_fridge_us_fan: {
    title: "LG -- Refrigerator E FF / E rF Fan Error Troubleshooting",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.lg.com/us/support/help-library/lg-refrigerator-troubleshooting-an-e-ff-or-e-rf-error-code--20153150964030",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  whirlpool_fridge_po: {
    title: "Whirlpool -- PO Error Code (French Door Bottom Freezer Refrigerator)",
    kind: "MANUFACTURER_PAGE",
    url: "https://producthelp.whirlpool.com/Refrigeration/Full-Size_Refrigerators/French_Door_Bottom_Freezer_Refrigerator/Control_Concerns/Error_Codes%2C_Blinking%2C_Flashing_Lights/Blinking_Lights/PO_Error_Code_-_Refrigerator",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  bosch_fridge_errors: {
    title: "Bosch -- Refrigeration Error Codes",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.bosch-home.com/us/owner-support/error-codes/refrigeration/",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
  haier_fridge_pk: {
    title: "Haier Pakistan -- Refrigerator and Freezer Error Codes",
    kind: "MANUFACTURER_PAGE",
    url: "https://www.haier.com/pk/service-support/self-service/20201208_151095.shtml",
    edition: ACCESSED_LABEL,
    capturedAt: CAPTURED_AT,
  },
} as const satisfies Record<string, SourceSeed>;

type SourceKey = keyof typeof SOURCES;

type SeedStep = {
  instruction: string;
  safetyClass: SafetyClass;
  difficulty: Difficulty | null;
  // A repair step may be supported by a different manufacturer source than the
  // error code it belongs to. When omitted, the error code's source is used.
  sourceKey?: SourceKey;
};

type SeedCode = {
  category: Category;
  brand: string;
  code: string;
  modelScope: ModelScope;
  meaning: string;
  sourceKey: SourceKey;
  steps: SeedStep[];
};

function userStep(instruction: string, sourceKey?: SourceKey): SeedStep {
  return { instruction, safetyClass: "USER_SAFE", difficulty: "EASY", sourceKey };
}

function moderateUserStep(instruction: string, sourceKey?: SourceKey): SeedStep {
  return { instruction, safetyClass: "USER_SAFE", difficulty: "MODERATE", sourceKey };
}

function technicianStep(instruction: string, sourceKey?: SourceKey): SeedStep {
  return { instruction, safetyClass: "TECHNICIAN_ONLY", difficulty: null, sourceKey };
}

// ---------------------------------------------------------------------------
// Shared repair-step groups
// ---------------------------------------------------------------------------

const SAMSUNG_WASHER_WATER_INLET_STEPS = [
  userStep("Check that the water supply taps are fully open."),
  userStep("Check that the water supply hoses are not kinked or clogged."),
  // Samsung's UK code page explicitly mentions checking for sufficient water
  // pressure; the Pakistan 4C/4E page used by the error code does not.
  userStep("Confirm that the household water supply has sufficient pressure.", "samsung_washer_uk"),
  userStep("Confirm that hot and cold supply hoses are connected to the correct taps, if the model uses both."),
  userStep(
    "If the manufacturer instructions for the model permit it, turn off the water supply before disconnecting a hose and gently clean the accessible mesh filter. Reconnect securely and check for leaks.",
  ),
  technicianStep(
    "If the code remains after the documented external water-supply checks, stop troubleshooting and contact Samsung service.",
  ),
];

const SAMSUNG_WASHER_DRAIN_STEPS = [
  userStep("Check that the drain hose is not kinked, frozen, or visibly blocked."),
  userStep("Check that the drain hose is positioned correctly for the model's drain connection."),
  userStep(
    "If the user manual identifies a user-accessible debris filter, follow that exact manual procedure to inspect and clean it. Be aware that residual water may spill.",
  ),
  technicianStep("If the code remains after the permitted hose/filter checks, contact Samsung service."),
];

const SAMSUNG_WASHER_DOOR_STEPS = [
  userStep("Open and close the door firmly using the normal handle."),
  userStep("Check that laundry is not trapped between the door and door seal."),
  technicianStep(
    "If the door closes correctly but the code persists, contact Samsung service; do not bypass the door interlock.",
  ),
];

const SAMSUNG_WASHER_UNBALANCE_STEPS = [
  userStep("Pause the cycle and redistribute laundry evenly around the drum."),
  userStep("Check that the washer is standing on a flat, stable surface."),
  userStep("If only one item or clothing needs washing, check the message shown in the display."),
  technicianStep(
    "If the code repeatedly appears with a balanced load and level machine, contact Samsung service.",
  ),
];

const SAMSUNG_WASHER_OVERFLOW_STEPS = [
  userStep("Restart the washer after spinning."),
  technicianStep(
    "If the information code remains on the display, contact Samsung service. Do not open the cabinet or work on valves or electrical parts.",
  ),
];

const LG_WASHER_INLET_STEPS = [
  userStep("Confirm the water tap is fully open and the household water supply is available."),
  userStep("Check the inlet hose for kinks or visible damage."),
  userStep(
    "If the exact model manual permits it, turn off the water supply and clean the user-accessible inlet filter.",
  ),
  technicianStep("If water supply and hose checks do not resolve the error, contact LG service."),
];

const LG_WASHER_DRAIN_STEPS = [
  userStep("Check that the drain hose is not kinked, blocked, or installed contrary to the model manual."),
  userStep(
    "Lift the drain hose from the drain hole, run a spin cycle or spin-only cycle, and if water drains without issue, clean the drain hole.",
  ),
  technicianStep(
    "If drainage remains blocked, contact LG service; do not open the pump or electrical compartment.",
  ),
];

const LG_WASHER_UNBALANCE_STEPS = [
  userStep("Pause the washer and redistribute the laundry evenly."),
  userStep("Check that the appliance is level and stable."),
  technicianStep("If the error persists with a balanced load and level appliance, request service."),
];

const LG_WASHER_DOOR_STEPS = [
  userStep("Close the door or lid fully and check that laundry is not obstructing it."),
  technicianStep(
    "If the door/lid is closed but the error remains, contact LG service. Never bypass the door/lid lock.",
  ),
];

const LG_WASHER_MOTOR_STEPS = [
  userStep("Remove coins or other foreign objects trapped between the wash plate and drum, using tweezers if accessible."),
  technicianStep(
    "If no trapped object is visible but noise occurs and drum rotation is still affected, request LG service. Do not access motor wiring or internal drive components.",
  ),
];

const LG_WASHER_OVERFILL_STEPS = [
  userStep("Unplug the power cord, reconnect it, and operate the washer again."),
  userStep(
    "If the tub continues to fill to the point of overflowing, stop using the washer and request LG service; this may indicate a water-level sensor problem.",
  ),
];

const LG_WASHER_TEMPERATURE_SENSOR_STEPS = [
  userStep(
    "If hot water was poured into the tub, disconnect the power cord and wait for the water to cool before reconnecting it.",
  ),
  technicianStep(
    "If the error persists, request LG service inspection; the temperature sensor may require technician diagnosis.",
  ),
];

const WHIRLPOOL_WASHER_LOW_WATER_STEPS = [
  userStep(
    "Confirm the household water supply is on and both hot and cold taps are fully open where the model uses both.",
  ),
  userStep("Check the inlet hoses for kinks."),
  userStep(
    "Check that the installation does not use an incompatible flood-safe hose/device, as described by the manufacturer.",
  ),
  technicianStep("If the supply is correct and the error persists, contact Whirlpool service."),
];

const WHIRLPOOL_WASHER_DRAIN_STEPS = [
  userStep("Check that the drain hose is not kinked or clogged."),
  userStep(
    "Use the U-shaped drain hose form and confirm the standpipe height is between 39 in. (99 cm) and 96 in. (244 cm), as specified by the cited Whirlpool guide; verify the exact model's installation requirements.",
  ),
  userStep("Make sure you are using HE (High Efficiency) detergent; excessive suds may delay draining."),
  technicianStep("If the drain path is clear and the code remains, contact Whirlpool service."),
];

const WHIRLPOOL_WASHER_MOTOR_STEPS = [
  userStep("Check that the washer is not overloaded."),
  userStep(
    "If the washer was recently installed, check the installation instructions to confirm shipping bolts were removed.",
  ),
  technicianStep(
    "If the code persists, contact Whirlpool service. Do not inspect motor wiring or internal drive components.",
  ),
];

const WHIRLPOOL_WASHER_DISPENSER_STEPS = [
  userStep("Inspect the user-removable detergent drawer/cartridge for visible detergent buildup."),
  userStep("Clean the removable dispenser part only as described in the model manual."),
  technicianStep("If the error persists, contact Whirlpool service."),
];

const WHIRLPOOL_WASHER_DOOR_LOCK_STEPS = [
  userStep("Press Pause or Cancel twice and the Power button once to clear the code."),
  userStep(
    "Check that the door is fully closed and that laundry or another object is not preventing the latch from engaging.",
  ),
  technicianStep(
    "If the door still will not lock, contact Whirlpool service. Do not bypass or dismantle the door lock.",
  ),
];

const BOSCH_WASHER_INLET_STEPS = [
  userStep(
    "Turn off the tap, take the hose off the tap, and clean the filters in the water supply hose using a small brush. Do not immerse an AquaStop safety device in water.",
  ),
  userStep(
    "For appliances without AquaStop, remove the hose from the back of the appliance, take out the filter with pliers, and clean it.",
  ),
  userStep(
    "Reconnect the hose, check for leaks, fully turn on the tap, and confirm that approximately 2.5 gallons (10 liters) of water per minute flows from the fully open tap.",
  ),
  technicianStep(
    "If the water pressure is too low, contact a qualified plumber. If the filters are clear and pressure is adequate but the error persists, contact Bosch service.",
  ),
];

const BOSCH_WASHER_DRAIN_STEPS = [
  userStep("Check that the external drain hose is not kinked or visibly blocked."),
  // The Bosch use-and-care manual identifies excess/non-HE detergent as a
  // contributor for this fault; the online E18/F18 page does not.
  userStep(
    "Use only HE (High Efficiency) detergent and the amount specified by the exact model's manual; excess or non-HE detergent can contribute to this fault.",
    "bosch_washer_manual",
  ),
  technicianStep(
    "The cited Bosch page describes cleaning the drain hose and siphon and cleaning the drain pump, with warnings about hot residual water. Follow the exact model's manual; if the manual does not define this as user maintenance, contact Bosch service.",
  ),
];

const BOSCH_WASHER_DOOR_STEPS = [
  userStep("Check that laundry is not caught in the washer door."),
  userStep("Close the door securely using the normal handle."),
  technicianStep(
    "If the door still will not close or the code persists, contact Bosch service. Do not bypass the door lock.",
  ),
];

const HAIER_WASHER_DRAIN_STEPS = [
  userStep(
    "Check whether the drain hose is blocked or set too high. Remove any blockage and press Start/Pause once more.",
  ),
  // The cited illustration shows two alternative washer configurations, not
  // two drainage pipes on one machine. Only the configuration that matches the
  // user's washer applies.
  userStep(
    "If the washer is a lower-drain type without an internal drain pump, the drain pipe installation height should be less than 10 cm. Position the drain hose at that height, then open and close the top lid once.",
    "haier_washer_e1_pk",
  ),
  userStep(
    "If the washer is an upper-drain type with an internal drain pump, the drain pipe installation height should be 80 cm-100 cm. Position the drain hose at that height, then open and close the top lid once.",
    "haier_washer_e1_pk",
  ),
  userStep(
    "If the drain hose is blocked or pressed, clean foreign material from the drain hose and release the hose, then open and close the top lid once.",
    "haier_washer_e1_pk",
  ),
  userStep(
    "If the drain hose has been extended too long, adjust it so the proper length is less than 3 m, including the original hose and any extension.",
    "haier_washer_e1_pk",
  ),
  technicianStep(
    "If the problem is not solved on an upper-drain washer that has an internal drain pump, the drain pump may be damaged; contact Haier service.",
    "haier_washer_e1_pk",
  ),
];

const HAIER_WASHER_LID_STEPS = [
  userStep("Close the top lid fully."),
  userStep("Press Start/Pause once more as described by Haier."),
  technicianStep("If the lid is closed but the code remains, contact Haier service. Do not bypass the lid lock."),
];

const HAIER_WASHER_SPIN_STEPS = [
  userStep("Redistribute the laundry evenly."),
  userStep("Check that the washer is level and stable."),
  technicianStep(
    "If the error persists with a balanced load and level machine, contact Haier service.",
  ),
];

const HAIER_WASHER_INLET_STEPS = [
  userStep(
    "Check whether there is a water outage or low water pressure. Wait until the water pressure returns to normal before use.",
    "haier_washer_e4_pk",
  ),
  userStep("Turn on the water tap, then press Start/Pause once more."),
  userStep("Clean the water inlet valve, then press Start/Pause once more."),
  userStep(
    "Check whether the water inlet hose is kinked, causing slow water inlet; straighten the inlet hose if it is kinked.",
    "haier_washer_e4_pk",
  ),
  userStep(
    "For upper-drain type machines, check the drain-hose height: the drain-hose outlet should be higher than 80 cm, and the highest point should be lower than 100 cm.",
    "haier_washer_e4_pk",
  ),
  userStep(
    "For upper-drain type machines, check whether the drain hose is inserted too deeply into the floor drain, causing the machine to siphon (water entering and draining simultaneously).",
    "haier_washer_e4_pk",
  ),
  technicianStep(
    "If the problem is not solved, contact Haier service for a service technician visit.",
    "haier_washer_e4_pk",
  ),
];

const HAIER_WASHER_WATER_LEVEL_SENSOR_STEPS = [
  technicianStep("Contact Haier customer care/service. Do not open the cabinet or inspect sensor wiring."),
];

const HAIER_WASHER_COMMUNICATION_STEPS = [
  technicianStep(
    "Stop troubleshooting and contact Haier service. Do not open the control panel or attempt board/wiring repairs.",
  ),
];

const HAIER_WASHER_CRITICAL_WATER_LEVEL_STEPS = [
  userStep("Contact Haier Customer Care; the cited page states that water has reached a critical level."),
  technicianStep(
    "Do not open the appliance or attempt valve or sensor repairs; Haier directs this fault to Customer Care.",
  ),
];

const SAMSUNG_FRIDGE_FREEZER_FAN_STEPS = [
  userStep("Check that freezer contents do not prevent the door from closing fully."),
  userStep("Visually check that the door gasket makes continuous contact around the door."),
  userStep(
    "If the exact model's Samsung instructions permit defrosting, protect food in suitable cold storage and follow those model-specific defrost instructions.",
  ),
  technicianStep(
    "If the code persists or fan motor failure is suspected, contact Samsung service. Do not remove internal panels or work on the fan wiring.",
  ),
];

const SAMSUNG_FRIDGE_REFRIGERATOR_FAN_STEPS = [
  userStep(
    "Check that the refrigerator door has not been left open and that food is not preventing it from closing.",
  ),
  userStep(
    "Follow Samsung's documented procedure for applicable models: unplug the refrigerator, leave the doors open for a few hours, then reconnect and close the doors. Do this only after moving perishable food to safe cold storage.",
  ),
  technicianStep("If the code returns, contact Samsung service."),
];

const SAMSUNG_FRIDGE_DEFROST_SENSOR_STEPS = [
  technicianStep(
    "Contact Samsung service for diagnosis. Do not access or replace internal sensors, wiring, heater, or control components.",
  ),
];

const SAMSUNG_FRIDGE_ICE_MAKER_SENSOR_STEPS = [
  technicianStep("Contact Samsung service. Do not access internal sensor wiring or replace components."),
];

const SAMSUNG_FRIDGE_ICE_PIPE_HEATER_STEPS = [
  technicianStep(
    "Contact Samsung service. Do not access the heater, internal wiring, or control components.",
  ),
];

const SAMSUNG_FRIDGE_COMPRESSOR_STEPS = [
  moderateUserStep(
    "Unplug the refrigerator or turn off power at the circuit breaker for 60 seconds, then turn it back on.",
  ),
  technicianStep(
    "If the code returns, contact Samsung service. Do not work on compressor or electrical components.",
  ),
];

const LG_FRIDGE_FREEZER_FAN_STEPS = [
  userStep("Move perishable food to another refrigerator or an insulated cooler before defrosting."),
  userStep("Place dry towels around the appliance to collect water from melting frost."),
  userStep(
    "For models covered by the cited LG guide, unplug the unit and leave both doors fully open for at least 24 hours to allow natural defrosting. Do not use a hair dryer, heat gun, or other heat source.",
  ),
  technicianStep(
    "If the error remains after the documented defrost procedure, contact LG service.",
  ),
];

const LG_FRIDGE_REFRIGERATOR_FAN_STEPS = [
  userStep(
    "Unplug the refrigerator or trip the exclusive circuit breaker to reset the power, then reuse it after about 5 minutes.",
  ),
  technicianStep(
    "If the same symptom or inspection code repeats, request an LG service technician for diagnosis; do not open internal panels or work on the fan motor.",
  ),
];

const WHIRLPOOL_FRIDGE_PO_STEPS = [
  userStep(
    "Check whether a power outage or interruption occurred; the PO indicator means the power supply to the refrigerator was off and the freezer temperature rose to 18°F (-8°C) or higher.",
  ),
  userStep(
    "On models covered by this Whirlpool guide, acknowledge the power-outage alert by pressing MEASURED FILL under Confirm. The PO code should then disappear and the display should return to the Home screen.",
  ),
  technicianStep(
    "If further help is needed, contact Whirlpool service or schedule service as directed by the cited page.",
  ),
];

const BOSCH_FRIDGE_POWER_RESET_STEP = moderateUserStep(
  "Switch the relevant breaker off for 30 seconds and restore it. Only offer this if the user can safely operate the breaker.",
);

const BOSCH_FRIDGE_ICEMAKER_STEPS = [
  technicianStep(
    "Bosch documents this as an icemaker/control-system fault. Do not open the appliance or work on internal wiring/components.",
  ),
  BOSCH_FRIDGE_POWER_RESET_STEP,
  technicianStep("If the error remains, contact Bosch Customer Support/service."),
];

const BOSCH_FRIDGE_DISPENSER_STEPS = [
  technicianStep("Do not dismantle the dispenser or access internal controls."),
  BOSCH_FRIDGE_POWER_RESET_STEP,
  technicianStep("If the error remains, contact Bosch Customer Support/service."),
];

const HAIER_FRIDGE_SENSOR_STEPS = [
  technicianStep(
    "Haier states that this sensor error cannot be resolved by the user. Stop troubleshooting and contact Haier service. Do not open the appliance or attempt sensor, wiring, or control-board replacement.",
  ),
];

const HAIER_FRIDGE_COMMUNICATION_STEPS = [
  technicianStep(
    "Contact Haier service for diagnosis. Do not open the appliance or work on control boards/wiring.",
  ),
];

const HAIER_FRIDGE_FAN_STEPS = [
  technicianStep(
    "Haier states that refrigerator error codes require technician service. Do not remove internal panels, access fan wiring, or replace a fan.",
  ),
];

const HAIER_FRIDGE_ICE_MAKER_STEPS = [
  technicianStep(
    "Contact Haier service. Do not dismantle the ice maker or access internal electrical parts.",
  ),
];

const HAIER_FRIDGE_DEFROST_STEPS = [
  technicianStep(
    "Contact Haier service. Do not access the defrost heater, internal sensors, wiring, or control board.",
  ),
];

// ---------------------------------------------------------------------------
// Error-code records
// ---------------------------------------------------------------------------

function codeGroup(
  category: Category,
  brand: string,
  codes: string[],
  modelScope: ModelScope,
  meaning: string,
  sourceKey: SourceKey,
  steps: SeedStep[],
): SeedCode[] {
  return codes.map((code) => ({ category, brand, code, modelScope, meaning, sourceKey, steps }));
}

const CODES: SeedCode[] = [
  // Samsung washing machines
  ...codeGroup(
    "WASHING_MACHINE",
    "SAMSUNG",
    ["4C", "4E"],
    "UNSPECIFIED",
    "Water is not being supplied to the washing machine.",
    "samsung_washer_pk",
    SAMSUNG_WASHER_WATER_INLET_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "SAMSUNG",
    ["5C", "5E"],
    "UNSPECIFIED",
    "Water is not draining from the washing machine.",
    "samsung_washer_uk",
    SAMSUNG_WASHER_DRAIN_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "SAMSUNG",
    ["dC", "dE"],
    "UNSPECIFIED",
    "The washer is operating with the door open or the door is not properly closed.",
    "samsung_washer_uk",
    SAMSUNG_WASHER_DOOR_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "SAMSUNG",
    ["Ub", "UE"],
    "UNSPECIFIED",
    "The washer cannot spin properly because the laundry load is unbalanced.",
    "samsung_washer_uk",
    SAMSUNG_WASHER_UNBALANCE_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "SAMSUNG",
    ["OC", "OE", "OF"],
    "UNSPECIFIED",
    "The washer has detected an overflow condition.",
    "samsung_washer_uk",
    SAMSUNG_WASHER_OVERFLOW_STEPS,
  ),

  // LG washing machines (the cited guide is explicitly top-load)
  ...codeGroup(
    "WASHING_MACHINE",
    "LG",
    ["IE"],
    "TOP_LOAD",
    "Inlet error; the washer is not receiving water correctly.",
    "lg_washer_topload",
    LG_WASHER_INLET_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "LG",
    ["OE"],
    "TOP_LOAD",
    "Outlet/drainage error.",
    "lg_washer_topload",
    LG_WASHER_DRAIN_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "LG",
    ["UE"],
    "TOP_LOAD",
    "Unbalanced load error.",
    "lg_washer_topload",
    LG_WASHER_UNBALANCE_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "LG",
    ["dE"],
    "TOP_LOAD",
    "Door/lid error.",
    "lg_washer_topload",
    LG_WASHER_DOOR_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "LG",
    ["LE", "LE1"],
    "TOP_LOAD",
    "Motor-stuck/rotation error in the cited LG top-load guide.",
    "lg_washer_topload",
    LG_WASHER_MOTOR_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "LG",
    ["FE"],
    "TOP_LOAD",
    "Overfill error.",
    "lg_washer_topload",
    LG_WASHER_OVERFILL_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "LG",
    ["tE"],
    "TOP_LOAD",
    "Temperature-sensor error.",
    "lg_washer_topload",
    LG_WASHER_TEMPERATURE_SENSOR_STEPS,
  ),

  // Whirlpool washing machines (front-load source only)
  ...codeGroup(
    "WASHING_MACHINE",
    "WHIRLPOOL",
    ["F8 E1", "LO FL"],
    "FRONT_LOAD",
    "Low water flow / washer is not detecting sufficient water supply.",
    "whirlpool_washer_frontload",
    WHIRLPOOL_WASHER_LOW_WATER_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "WHIRLPOOL",
    ["F9 E1"],
    "FRONT_LOAD",
    "Drain time is longer than expected.",
    "whirlpool_washer_frontload",
    WHIRLPOOL_WASHER_DRAIN_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "WHIRLPOOL",
    ["F7 E1"],
    "FRONT_LOAD",
    "Motor speed sensing error; motor is not achieving the expected speed.",
    "whirlpool_washer_frontload",
    WHIRLPOOL_WASHER_MOTOR_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "WHIRLPOOL",
    ["F8 E2"],
    "FRONT_LOAD",
    "Dispenser-system problem on select models.",
    "whirlpool_washer_frontload",
    WHIRLPOOL_WASHER_DISPENSER_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "WHIRLPOOL",
    ["F5 E2"],
    "FRONT_LOAD",
    "Door will not lock.",
    "whirlpool_washer_frontload",
    WHIRLPOOL_WASHER_DOOR_LOCK_STEPS,
  ),

  // Bosch washing machines
  ...codeGroup(
    "WASHING_MACHINE",
    "BOSCH",
    ["E17", "F17", "F29"],
    "UNSPECIFIED",
    "Water inlet problem; the filters in the water connection or AquaStop hose may be blocked, or the water pressure may be too low.",
    "bosch_washer_errors",
    BOSCH_WASHER_INLET_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "BOSCH",
    ["E18", "F18"],
    "UNSPECIFIED",
    "The drainage hose is blocked or kinked, or the drain pump is blocked.",
    "bosch_washer_errors",
    BOSCH_WASHER_DRAIN_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "BOSCH",
    ["E16"],
    "UNSPECIFIED",
    "Door is not closed properly.",
    "bosch_washer_manual",
    BOSCH_WASHER_DOOR_STEPS,
  ),

  // Haier washing machines (cited top-load troubleshooting page)
  ...codeGroup(
    "WASHING_MACHINE",
    "HAIER",
    ["E1"],
    "TOP_LOAD",
    "The machine does not drain or drains slowly; the drain hose may be blocked or set too high.",
    "haier_washer_topload",
    HAIER_WASHER_DRAIN_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "HAIER",
    ["E2"],
    "TOP_LOAD",
    "Top lid is not closed.",
    "haier_washer_topload",
    HAIER_WASHER_LID_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "HAIER",
    ["E3"],
    "TOP_LOAD",
    "Washer does not spin because the laundry may be unbalanced or the machine may not be level.",
    "haier_washer_topload",
    HAIER_WASHER_SPIN_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "HAIER",
    ["E4"],
    "TOP_LOAD",
    "Water inlet problem; the water tap may be closed or the water supply interrupted, the water inlet valve may be blocked, or the water pressure may be too low.",
    "haier_washer_topload",
    HAIER_WASHER_INLET_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "HAIER",
    ["FA"],
    "TOP_LOAD",
    "Water-level sensor failure.",
    "haier_washer_topload",
    HAIER_WASHER_WATER_LEVEL_SENSOR_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "HAIER",
    ["FC2"],
    "TOP_LOAD",
    "Communication failure between display board and power board.",
    "haier_washer_topload",
    HAIER_WASHER_COMMUNICATION_STEPS,
  ),
  ...codeGroup(
    "WASHING_MACHINE",
    "HAIER",
    ["F2"],
    "TOP_LOAD",
    "Water has reached a critical level.",
    "haier_washer_topload",
    HAIER_WASHER_CRITICAL_WATER_LEVEL_STEPS,
  ),

  // Samsung refrigerators
  ...codeGroup(
    "REFRIGERATOR",
    "SAMSUNG",
    ["21E"],
    "UNSPECIFIED",
    "Freezer fan error; the fan may be obstructed by frost, the door/gasket may have allowed warm air in, or the fan motor may have failed.",
    "samsung_fridge_us",
    SAMSUNG_FRIDGE_FREEZER_FAN_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "SAMSUNG",
    ["22E", "22C"],
    "UNSPECIFIED",
    "Refrigerator compartment fan error.",
    "samsung_fridge_us",
    SAMSUNG_FRIDGE_REFRIGERATOR_FAN_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "SAMSUNG",
    ["5E"],
    "UNSPECIFIED",
    "Refrigerator defrost sensor error.",
    "samsung_fridge_us",
    SAMSUNG_FRIDGE_DEFROST_SENSOR_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "SAMSUNG",
    ["8E"],
    "UNSPECIFIED",
    "Freezer ice-maker sensor error.",
    "samsung_fridge_us",
    SAMSUNG_FRIDGE_ICE_MAKER_SENSOR_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "SAMSUNG",
    ["14E"],
    "UNSPECIFIED",
    "Ice-maker sensor error.",
    "samsung_fridge_us",
    SAMSUNG_FRIDGE_ICE_MAKER_SENSOR_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "SAMSUNG",
    ["33E"],
    "UNSPECIFIED",
    "Ice-pipe heater error.",
    "samsung_fridge_us",
    SAMSUNG_FRIDGE_ICE_PIPE_HEATER_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "SAMSUNG",
    ["83E", "85E", "86E"],
    "UNSPECIFIED",
    "Compressor abnormal-current detection / voltage or power-related error.",
    "samsung_fridge_us",
    SAMSUNG_FRIDGE_COMPRESSOR_STEPS,
  ),

  // LG refrigerators
  ...codeGroup(
    "REFRIGERATOR",
    "LG",
    ["Er FF", "E FF"],
    "UNSPECIFIED",
    "Freezer fan abnormality; frost/ice buildup may prevent the freezer fan from turning.",
    "lg_fridge_us_ff",
    LG_FRIDGE_FREEZER_FAN_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "LG",
    ["Er rF", "E rF"],
    "UNSPECIFIED",
    "Refrigerator-compartment fan abnormality.",
    "lg_fridge_us_fan",
    LG_FRIDGE_REFRIGERATOR_FAN_STEPS,
  ),

  // Whirlpool refrigerators (French Door Bottom Freezer source only)
  ...codeGroup(
    "REFRIGERATOR",
    "WHIRLPOOL",
    ["PO"],
    "FRENCH_DOOR_BOTTOM_FREEZER",
    "Power outage indicator; the refrigerator lost power and freezer temperature rose to 18°F (-8°C) or higher.",
    "whirlpool_fridge_po",
    WHIRLPOOL_FRIDGE_PO_STEPS,
  ),

  // Bosch refrigerators
  ...codeGroup(
    "REFRIGERATOR",
    "BOSCH",
    ["E02"],
    "UNSPECIFIED",
    "Icemaker fault or communication issue in the ice-water system controls.",
    "bosch_fridge_errors",
    BOSCH_FRIDGE_ICEMAKER_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "BOSCH",
    ["E03"],
    "UNSPECIFIED",
    "Dispenser user-interface fault/error.",
    "bosch_fridge_errors",
    BOSCH_FRIDGE_DISPENSER_STEPS,
  ),

  // Haier refrigerators
  ...codeGroup(
    "REFRIGERATOR",
    "HAIER",
    ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "FR", "Eh"],
    "UNSPECIFIED",
    "Refrigerator sensor error; exact sensor and diagnosis depend on the model/series.",
    "haier_fridge_pk",
    HAIER_FRIDGE_SENSOR_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "HAIER",
    ["E0"],
    "UNSPECIFIED",
    "Communication error.",
    "haier_fridge_pk",
    HAIER_FRIDGE_COMMUNICATION_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "HAIER",
    ["E1", "E2", "E6", "E9"],
    "UNSPECIFIED",
    "Refrigerator fan error; exact fan and cause depend on the model/series.",
    "haier_fridge_pk",
    HAIER_FRIDGE_FAN_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "HAIER",
    ["Er"],
    "UNSPECIFIED",
    "Ice-maker error.",
    "haier_fridge_pk",
    HAIER_FRIDGE_ICE_MAKER_STEPS,
  ),
  ...codeGroup(
    "REFRIGERATOR",
    "HAIER",
    ["Ec", "Ed", "Fd", "Rd", "Hd"],
    "UNSPECIFIED",
    "Defrost-system error.",
    "haier_fridge_pk",
    HAIER_FRIDGE_DEFROST_STEPS,
  ),
];

/*
 * The LG refrigerator "F" code is deliberately not seeded. The cited LG guide
 * says a standalone "F" is only this fan error when the exact model's display
 * or manual identifies it that way. Without a confirmed model, adding it would
 * imply model compatibility the source does not establish.
 */
const SKIPPED_CONDITIONAL_CODES = [
  {
    category: "REFRIGERATOR" as const,
    brand: "LG",
    code: "F",
    reason:
      "Requires confirmation that the exact LG model's display/manual identifies a standalone F as the freezer-fan error.",
  },
];

// ---------------------------------------------------------------------------
// In-memory validation (runs before any database write)
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set<Category>(["WASHING_MACHINE", "REFRIGERATOR"]);
const VALID_BRANDS = new Set(["SAMSUNG", "LG", "WHIRLPOOL", "BOSCH", "HAIER"]);
const VALID_MODEL_SCOPES = new Set<ModelScope>([
  "UNSPECIFIED",
  "TOP_LOAD",
  "FRONT_LOAD",
  "FRENCH_DOOR_BOTTOM_FREEZER",
]);
const VALID_SAFETY_CLASSES = new Set<SafetyClass>(["USER_SAFE", "TECHNICIAN_ONLY"]);
const VALID_DIFFICULTIES = new Set<Difficulty>(["EASY", "MODERATE", "HARD"]);

function validateSeedData(): void {
  const errors: string[] = [];
  const usedSourceKeys = new Set<SourceKey>();
  const seenSourceTitles = new Set<string>();
  const seenSourceUrls = new Set<string>();

  for (const [key, source] of Object.entries(SOURCES)) {
    if (!source.title.trim()) errors.push(`Source ${key} has an empty title.`);
    if (!source.url.trim()) errors.push(`Source ${key} has an empty URL.`);
    if ((source.kind as string) === "TEST_FIXTURE") {
      errors.push(`Source ${key} must not use TEST_FIXTURE for this dataset.`);
    }

    const titleKey = source.title.trim().toLowerCase();
    if (seenSourceTitles.has(titleKey)) {
      errors.push(`Source ${key} duplicates the title of another seed source.`);
    }
    seenSourceTitles.add(titleKey);

    const urlKey = source.url.trim().toLowerCase();
    if (seenSourceUrls.has(urlKey)) {
      errors.push(`Source ${key} duplicates the URL of another seed source.`);
    }
    seenSourceUrls.add(urlKey);
  }

  const seenCodes = new Set<string>();

  for (const record of CODES) {
    const label = `${record.category}/${record.brand}/${record.code}/${record.modelScope}`;

    if (!VALID_CATEGORIES.has(record.category)) {
      errors.push(`${label}: unsupported appliance category.`);
    }
    if (!VALID_BRANDS.has(record.brand)) {
      errors.push(`${label}: brand must be one of ${[...VALID_BRANDS].join(", ")}.`);
    }
    if (!record.code.trim()) {
      errors.push(`${label}: error code is empty.`);
    }
    if (record.code !== record.code.trim()) {
      errors.push(`${label}: error code has leading/trailing whitespace.`);
    }
    if (!record.modelScope.trim()) {
      errors.push(`${label}: modelScope must not be empty.`);
    }
    if (!VALID_MODEL_SCOPES.has(record.modelScope)) {
      errors.push(`${label}: unsupported modelScope "${record.modelScope}".`);
    }
    if (!record.meaning.trim()) {
      errors.push(`${label}: meaning is empty.`);
    }
    if (!(record.sourceKey in SOURCES)) {
      errors.push(`${label}: source key "${record.sourceKey}" does not exist.`);
    } else {
      usedSourceKeys.add(record.sourceKey);
    }
    if (record.steps.length === 0) {
      errors.push(`${label}: every error code must have at least one repair step.`);
    }

    const key = `${record.category}\u0000${record.brand}\u0000${record.code}\u0000${record.modelScope}`;
    if (seenCodes.has(key)) {
      errors.push(`${label}: duplicate error-code record in the seed data.`);
    }
    seenCodes.add(key);

    const seenSteps = new Set<string>();
    for (const [index, step] of record.steps.entries()) {
      const position = index + 1;
      const stepLabel = `${label} step ${position}`;

      if (!step.instruction.trim()) {
        errors.push(`${stepLabel}: instruction is empty.`);
      }
      if (!VALID_SAFETY_CLASSES.has(step.safetyClass)) {
        errors.push(`${stepLabel}: unsupported safetyClass.`);
      }
      if (step.safetyClass === "TECHNICIAN_ONLY" && step.difficulty !== null) {
        errors.push(`${stepLabel}: technician-only steps must use difficulty null.`);
      }
      if (step.safetyClass === "USER_SAFE" && step.difficulty === null) {
        errors.push(`${stepLabel}: user-safe steps must have a difficulty.`);
      }
      if (step.difficulty !== null && !VALID_DIFFICULTIES.has(step.difficulty)) {
        errors.push(`${stepLabel}: unsupported difficulty.`);
      }
      if (step.sourceKey) {
        if (!(step.sourceKey in SOURCES)) {
          errors.push(`${stepLabel}: source key "${step.sourceKey}" does not exist.`);
        } else {
          usedSourceKeys.add(step.sourceKey);
        }
      }

      // Positions are generated from array order, so this also proves they are
      // sequential. Duplicate step identities would create colliding links.
      const stepKey = `${step.safetyClass}\u0000${step.instruction}`;
      if (seenSteps.has(stepKey)) {
        errors.push(`${stepLabel}: duplicate step within the same error code.`);
      }
      seenSteps.add(stepKey);
    }
  }

  // The seed must not create catalogue-only sources. Every source definition
  // has to be referenced by at least one error code or repair step.
  const unusedSources = (Object.keys(SOURCES) as SourceKey[]).filter((key) => !usedSourceKeys.has(key));
  if (unusedSources.length > 0) {
    errors.push(
      `Unused source definitions: ${unusedSources.join(", ")}. Only sources referenced by an ErrorCode or RepairStep may be created.`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Seed data validation failed:\n- ${errors.join("\n- ")}`);
  }
}

function getUsedSourceKeys(): SourceKey[] {
  const used = new Set<SourceKey>();

  for (const code of CODES) {
    used.add(code.sourceKey);
    for (const step of code.steps) {
      if (step.sourceKey) used.add(step.sourceKey);
    }
  }

  return (Object.keys(SOURCES) as SourceKey[]).filter((key) => used.has(key));
}

// ---------------------------------------------------------------------------
// Idempotent database writes
// ---------------------------------------------------------------------------

class SeedConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedConflictError";
  }
}

type Counts = { created: number; reused: number };

const counts: Record<"sources" | "errorCodes" | "repairSteps" | "links", Counts> = {
  sources: { created: 0, reused: 0 },
  errorCodes: { created: 0, reused: 0 },
  repairSteps: { created: 0, reused: 0 },
  links: { created: 0, reused: 0 },
};

type SeedTx = Prisma.TransactionClient;

async function getOrCreateSource(tx: SeedTx, key: SourceKey) {
  const seed = SOURCES[key];

  // KnowledgeSource has no unique constraint, so detect duplicate identities
  // explicitly instead of silently picking the first matching row.
  const matches = await tx.knowledgeSource.findMany({
    where: { title: seed.title, url: seed.url },
    take: 2,
  });

  if (matches.length > 1) {
    throw new SeedConflictError(
      `Multiple knowledge sources match title "${seed.title}" and URL ${seed.url}. Resolve the ambiguity before re-running the seed.`,
    );
  }

  if (matches.length === 1) {
    const existing = matches[0];

    if (existing.kind !== seed.kind) {
      throw new SeedConflictError(
        `Source "${seed.title}" already exists with kind ${existing.kind}; seed expects ${seed.kind}.`,
      );
    }
    if (existing.edition !== seed.edition) {
      throw new SeedConflictError(
        `Source "${seed.title}" already exists with a different edition; seed expects "${seed.edition}". Review the conflict instead of overwriting existing metadata.`,
      );
    }
    if (existing.capturedAt.getTime() !== seed.capturedAt.getTime()) {
      throw new SeedConflictError(
        `Source "${seed.title}" already exists with a different capturedAt value; seed expects ${seed.capturedAt.toISOString()}. Review the conflict instead of overwriting existing metadata.`,
      );
    }

    counts.sources.reused += 1;
    return existing;
  }

  // Guard against creating a second row for the same title under a different
  // URL, or the same URL under a different title.
  const sameTitle = await tx.knowledgeSource.findFirst({ where: { title: seed.title } });
  if (sameTitle) {
    throw new SeedConflictError(
      `Source title "${seed.title}" already exists with URL ${sameTitle.url}; seed expects ${seed.url}.`,
    );
  }

  const sameUrl = await tx.knowledgeSource.findFirst({ where: { url: seed.url } });
  if (sameUrl) {
    throw new SeedConflictError(
      `Source URL ${seed.url} already exists with title "${sameUrl.title}"; seed expects "${seed.title}".`,
    );
  }

  const created = await tx.knowledgeSource.create({
    data: {
      title: seed.title,
      kind: seed.kind,
      url: seed.url,
      edition: seed.edition,
      capturedAt: seed.capturedAt,
    },
  });
  counts.sources.created += 1;
  return created;
}

async function getOrCreateErrorCode(tx: SeedTx, seed: SeedCode, sourceId: string) {
  const existing = await tx.errorCode.findUnique({
    where: {
      category_brand_code_modelScope: {
        category: seed.category,
        brand: seed.brand,
        code: seed.code,
        modelScope: seed.modelScope,
      },
    },
  });

  if (existing) {
    if (existing.meaning !== seed.meaning) {
      throw new SeedConflictError(
        `Error code ${seed.category}/${seed.brand}/${seed.code}/${seed.modelScope} already exists with a different meaning. Review the conflict instead of overwriting it.`,
      );
    }
    if (existing.sourceId !== sourceId) {
      throw new SeedConflictError(
        `Error code ${seed.category}/${seed.brand}/${seed.code}/${seed.modelScope} already exists with a different source. Review the conflict instead of overwriting it.`,
      );
    }
    counts.errorCodes.reused += 1;
    return existing;
  }

  const created = await tx.errorCode.create({
    data: {
      category: seed.category,
      brand: seed.brand,
      code: seed.code,
      modelScope: seed.modelScope,
      meaning: seed.meaning,
      sourceId,
      reviewStatus: "UNREVIEWED",
    },
  });
  counts.errorCodes.created += 1;
  return created;
}

async function getOrCreateRepairStep(
  tx: SeedTx,
  step: SeedStep,
  sourceId: string,
  sourceLabel: string,
) {
  // RepairStep has no natural unique constraint. Identity is source + exact
  // instruction + safety class, as specified by the dataset handoff.
  const matches = await tx.repairStep.findMany({
    where: {
      sourceId,
      instruction: step.instruction,
      safetyClass: step.safetyClass,
    },
    take: 2,
  });

  if (matches.length > 1) {
    throw new SeedConflictError(
      `Multiple repair steps match source "${sourceLabel}", safety ${step.safetyClass}, and instruction "${step.instruction}". Resolve the ambiguity before re-running the seed.`,
    );
  }

  if (matches.length === 1) {
    if (matches[0].difficulty !== step.difficulty) {
      throw new SeedConflictError(
        `Repair step "${step.instruction}" for source "${sourceLabel}" already exists with difficulty ${matches[0].difficulty ?? "null"}; seed expects ${step.difficulty ?? "null"}. Review the conflict instead of overwriting it.`,
      );
    }
    counts.repairSteps.reused += 1;
    return matches[0];
  }

  const created = await tx.repairStep.create({
    data: {
      sourceId,
      instruction: step.instruction,
      safetyClass: step.safetyClass,
      difficulty: step.difficulty,
      reviewStatus: "UNREVIEWED",
    },
  });
  counts.repairSteps.created += 1;
  return created;
}

async function getOrCreateLink(
  tx: SeedTx,
  errorCodeId: string,
  repairStepId: string,
  position: number,
) {
  const existing = await tx.errorCodeRepairStep.findUnique({
    where: { errorCodeId_repairStepId: { errorCodeId, repairStepId } },
  });

  if (existing) {
    if (existing.position !== position) {
      throw new SeedConflictError(
        `Link ${errorCodeId}/${repairStepId} already exists at position ${existing.position}; seed expects ${position}.`,
      );
    }
    counts.links.reused += 1;
    return existing;
  }

  const positionTaken = await tx.errorCodeRepairStep.findUnique({
    where: { errorCodeId_position: { errorCodeId, position } },
  });

  if (positionTaken) {
    throw new SeedConflictError(
      `Error code ${errorCodeId} already has a different repair step at position ${position}. Resolve the conflict before re-running the seed.`,
    );
  }

  const created = await tx.errorCodeRepairStep.create({
    data: {
      errorCodeId,
      repairStepId,
      position,
      reviewStatus: "UNREVIEWED",
    },
  });
  counts.links.created += 1;
  return created;
}

async function runSeed(): Promise<void> {
  assertDevelopmentSeedTarget();

  validateSeedData();

  // Create only sources that are actually referenced by an ErrorCode or a
  // RepairStep. The in-memory validation above rejects catalogue-only sources.
  const sourceKeys = getUsedSourceKeys();

  // One transaction keeps the three knowledge layers and their links consistent.
  // It also means a detected conflict rolls back every write from this run.
  //
  // The dataset is small in row count but performs several hundred sequential
  // round trips against a remote Neon database (~15 sources, 77 codes, ~120
  // steps, ~190 links, plus lookups). A 300-second ceiling bounds a slow remote
  // run without being an arbitrary expansion.
  await seedPrisma.$transaction(
    async (tx) => {
      const sourceIds = new Map<SourceKey, string>();

      for (const key of sourceKeys) {
        const source = await getOrCreateSource(tx, key);
        sourceIds.set(key, source.id);
      }

      for (const seedCode of CODES) {
        const sourceId = sourceIds.get(seedCode.sourceKey);
        if (!sourceId) {
          throw new Error(`Internal seed error: no source id for "${seedCode.sourceKey}".`);
        }

        const errorCode = await getOrCreateErrorCode(tx, seedCode, sourceId);

        for (const [index, step] of seedCode.steps.entries()) {
          const stepSourceKey = step.sourceKey ?? seedCode.sourceKey;
          const stepSourceId = sourceIds.get(stepSourceKey);
          if (!stepSourceId) {
            throw new Error(`Internal seed error: no source id for "${stepSourceKey}".`);
          }

          const repairStep = await getOrCreateRepairStep(
            tx,
            step,
            stepSourceId,
            SOURCES[stepSourceKey].title,
          );
          await getOrCreateLink(tx, errorCode.id, repairStep.id, index + 1);
        }
      }
    },
    { maxWait: 10_000, timeout: 300_000 },
  );
}

function redactSecrets(message: string): string {
  let safe = message.replace(/postgres(ql)?:\/\/[^\s"']+/gi, "[redacted database URL]");
  for (const key of ["DATABASE_URL", "DIRECT_URL", "JWT_ACCESS_SECRET"] as const) {
    const value = process.env[key];
    if (value) safe = safe.split(value).join(`[redacted ${key}]`);
  }
  return safe;
}

function printSummary(): void {
  console.log("\nFixit knowledge-base seed complete.");
  console.log(
    `Environment: ${process.env.NODE_ENV ?? "development"} (${usingDirectConnection ? "DIRECT_URL" : "DATABASE_URL"} used; connection string not printed)`,
  );
  console.log(`Knowledge sources:        ${counts.sources.created} created, ${counts.sources.reused} reused`);
  console.log(`Error codes:              ${counts.errorCodes.created} created, ${counts.errorCodes.reused} reused`);
  console.log(`Repair steps:             ${counts.repairSteps.created} created, ${counts.repairSteps.reused} reused`);
  console.log(`Error-code/step links:    ${counts.links.created} created, ${counts.links.reused} reused`);
  console.log(`Conflicts:                0`);
  console.log("All records created by this seed are UNREVIEWED; no review status was changed.");
  console.log("No record was marked APPROVED. This is not production-approved knowledge.");

  if (SKIPPED_CONDITIONAL_CODES.length > 0) {
    console.log("\nConditional records intentionally skipped:");
    for (const skipped of SKIPPED_CONDITIONAL_CODES) {
      console.log(`  - ${skipped.category}/${skipped.brand}/${skipped.code}: ${skipped.reason}`);
    }
  }
}

async function main(): Promise<void> {
  try {
    await runSeed();
    printSummary();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Seed aborted; no changes were committed.\n${redactSecrets(message)}`);
    process.exitCode = 1;
  } finally {
    await seedPrisma.$disconnect();
  }
}

main();
