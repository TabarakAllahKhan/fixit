# Fixit Knowledge Base Starter Dataset

## Manufacturer-documented washing-machine and refrigerator error codes

**Prepared:** 14 November 2026\
**Purpose:** Implementation handoff for OpenCode to build an idempotent
Prisma seed script for the existing Fixit knowledge schema.\
**Appliance categories:** `WASHING_MACHINE`, `REFRIGERATOR`\
**Brands:** `SAMSUNG`, `LG`, `WHIRLPOOL`, `BOSCH`, `HAIER`

------------------------------------------------------------------------

## 1. Important implementation rules

This document is intended to be used with the existing Prisma schema. Do
not change the schema to fit this document.

### Required schema enums

-   `ApplianceCategory`: `WASHING_MACHINE`, `REFRIGERATOR`
-   `SourceKind`: `MANUAL`, `MANUFACTURER_PAGE`, `OTHER`, `TEST_FIXTURE`
-   `ReviewStatus`: `UNREVIEWED`, `APPROVED`, `REJECTED`
-   `SafetyClass`: `USER_SAFE`, `TECHNICIAN_ONLY`
-   `Difficulty`: `EASY`, `MODERATE`, `HARD`

### Seed safety rules

1.  **Create all manufacturer knowledge as `UNREVIEWED`.** This file is
    a research-backed starter dataset, not a completed engineering
    review or model-by-model validation. Never seed these records as
    `APPROVED`.
2.  Use `MANUFACTURER_PAGE` for the manufacturer support pages listed
    below. Use `MANUAL` only when the actual appliance manual is the
    source.
3.  Do not create invented codes, meanings, model numbers, or repair
    steps.
4.  Preserve the error-code spelling and capitalization shown by the
    manufacturer. Examples: `dE`, `Er`, `FR`, `PO`, `22C`.
5.  A code is not universal across a brand. The same code may mean
    something different on another model, series, or appliance category.
6.  `modelScope` is a required string. Use the exact scope stated below:
    -   `TOP_LOAD` or `FRONT_LOAD` only where the cited manufacturer
        page explicitly identifies that family.
    -   `FRENCH_DOOR_BOTTOM_FREEZER` only for the Whirlpool refrigerator
        PO entry.
    -   `UNSPECIFIED` where the manufacturer source does not establish a
        reliable family/model scope.
7.  `UNSPECIFIED` is **not a wildcard**. Do not retrieve an
    `UNSPECIFIED` record as a match for a known appliance model. Do not
    use it to imply model compatibility. Require model-specific
    verification before returning its repair guidance to a user.
8.  Never assume a model-family scope is sufficient for an exact model.
    Confirm the model family from the sticker and the manufacturer's
    applicable documentation before approving or serving a record.
9.  Only mark a repair step `USER_SAFE` when the cited manufacturer
    instructions explicitly describe an ordinary user check/action.
    Electrical work, internal component work, refrigerant work, gas
    work, sensor/board replacement, compressor work, or opening sealed
    systems must never be presented as DIY.
10. A `TECHNICIAN_ONLY` step should tell the user to stop
    troubleshooting and contact an appropriately qualified/authorized
    technician. Do not add component replacement instructions.
11. Do not use a generic power reset unless the specific source for that
    code explicitly recommends it. Samsung specifically warns not to
    unplug refrigerators or manipulate their panels unless instructed.
12. Do not add repair steps based on a third-party code list or general
    model knowledge. The source URL must support the meaning and each
    instruction.
13. Do not seed symptom-based diagnoses from this error-code document.
    Symptom knowledge requires its own reviewed source-backed
    records/design.

### Existing schema mapping

Each code must map to one `ErrorCode` record and one or more
`RepairStep` records linked through `ErrorCodeRepairStep`.

-   `ErrorCode.category`: one of the two `ApplianceCategory` values.
-   `ErrorCode.brand`: uppercase brand name exactly as listed,
    e.g. `SAMSUNG`.
-   `ErrorCode.code`: exact manufacturer code string.
-   `ErrorCode.modelScope`: exact scope in each record below.
-   `ErrorCode.meaning`: concise manufacturer-supported meaning.
-   `ErrorCode.sourceId`: the `KnowledgeSource` record for the source
    URL.
-   `ErrorCode.reviewStatus`: always `UNREVIEWED` at initial seed.
-   `RepairStep.sourceId`: source record supporting that instruction.
-   `RepairStep.safetyClass`: `USER_SAFE` or `TECHNICIAN_ONLY`.
-   `RepairStep.difficulty`: `EASY` for simple external checks; `null`
    for technician-only steps unless a reviewer has a defensible reason
    to assign one.
-   `RepairStep.reviewStatus`: always `UNREVIEWED`.
-   `ErrorCodeRepairStep.position`: start at `1` and increment in
    display order.
-   `ErrorCodeRepairStep.reviewStatus`: always `UNREVIEWED`.

The schema has no `modelNumber` field on `ErrorCode`; do not invent one
or modify the schema. `modelScope` is a plain string and must be handled
carefully by the retrieval service.

------------------------------------------------------------------------

## 2. Source catalogue

Create a `KnowledgeSource` for each URL used below. A single source may
support multiple error codes.

For each source: - `title`: use the title shown below. - `kind`:
`MANUFACTURER_PAGE`. - `url`: exact URL below. - `edition`: a short
label such as
`Official manufacturer support page; accessed 2026-11-14`. -
`capturedAt`: timestamp of the seed/research capture. Use a valid `Date`
value. - `createdAt` and `updatedAt`: Prisma defaults.

### Source IDs / keys for seed code

Use stable local constants in the seed script, not hard-coded database
UUIDs:

  -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  Source key                     Title                   URL
  ------------------------------ ----------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  `samsung_washer_uk`            Samsung -- Washing      https://www.samsung.com/uk/support/home-appliances/check-out-the-information-codes-on-my-washing-machine/
                                 machine information     
                                 codes                   

  `samsung_washer_pk`            Samsung Pakistan --     https://www.samsung.com/pk/support/home-appliances/resolve-4c-4e-nf-or-nf1-error-codes-on-your-samsung-washing-machine/
                                 4C/4E/NF/NF1 water      
                                 supply troubleshooting  

  `lg_washer_topload`            LG -- Top Load Washer   https://www.lg.com/us/support/help-library/lg-top-load-washer-error-code-list-CT10000010-20154403824104
                                 Error Code List         

  `lg_washer_common`             LG -- Washing machine   https://www.lg.com/eg_en/support/product-support/troubleshoot/help-library/cs-CT52008194-20152666096790/
                                 common error messages   

  `whirlpool_washer_frontload`   Whirlpool -- Error      https://producthelp.whirlpool.com/Laundry/Washers/Product_Info/Washer_Product_Assistance/Error_Codes_in_Front_Load_Washers
                                 Codes in Front Load     
                                 Washers                 

  `bosch_washer_errors`          Bosch -- Washer error   https://www.bosch-home.com/us/en/c/spotlight/blt341dacb48f00c362/owner-support/error-codes/washers
                                 codes                   

  `bosch_washer_manual`          Bosch -- Use and Care   https://media3.bosch-home.com/Documents/9000825639_D.pdf
                                 Manual (washer error    
                                 messages)               

  `haier_washer_topload`         Haier India -- Top Load https://www.haier.com/in/service-support/self-service/20240828_249143.shtml
                                 Washing Machine         
                                 Troubleshooting         

  `haier_washer_e4_pk`           Haier Pakistan --       https://www.haier.com/pk/service-support/self-service/20261023_295891.shtml
                                 Washing Machine E4      
                                 Water Inlet Failure     

  `haier_washer_e1_pk`           Haier Pakistan --       https://www.haier.com/pk/service-support/self-service/20261016_295632.shtml
                                 Washing Machine E1      
                                 Drainage Error          

  `samsung_fridge_us`            Samsung -- Refrigerator https://www.samsung.com/us/support/troubleshoot/TSG10007315/
                                 Error Codes             

  `lg_fridge_us_ff`              LG -- Er FF / E FF / F  https://www.lg.com/us/support/help-library/if-you-see-an-er-ff-e-ff-or-f-error-code-on-your-lg-refrigerator--20155452969338
                                 Refrigerator Error Code 

  `lg_fridge_us_fan`             LG -- Refrigerator E FF https://www.lg.com/us/support/help-library/lg-refrigerator-troubleshooting-an-e-ff-or-e-rf-error-code--20153150964030
                                 / E rF Fan Error        
                                 Troubleshooting         

  `whirlpool_fridge_po`          Whirlpool -- PO Error   https://producthelp.whirlpool.com/Refrigeration/Full-Size_Refrigerators/French_Door_Bottom_Freezer_Refrigerator/Control_Concerns/Error_Codes%2C_Blinking%2C_Flashing_Lights/Blinking_Lights/PO_Error_Code\_-\_Refrigerator
                                 Code (French Door       
                                 Bottom Freezer          
                                 Refrigerator)           

  `bosch_fridge_errors`          Bosch -- Refrigeration  https://www.bosch-home.com/us/owner-support/error-codes/refrigeration/
                                 Error Codes             

  `haier_fridge_pk`              Haier Pakistan --       https://www.haier.com/pk/service-support/self-service/20201208_151095.shtml
                                 Refrigerator and        
                                 Freezer Error Codes     
  -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

------------------------------------------------------------------------

## 3. Washing machine records

### 3.1 Samsung

**Source:** `samsung_washer_uk` unless otherwise stated. Samsung notes
that codes can vary by model; use `modelScope: "UNSPECIFIED"` for this
general page and do not wildcard-match it.

#### Code: `4C`

-   `category`: `WASHING_MACHINE`
-   `brand`: `SAMSUNG`
-   `code`: `4C`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Water is not being supplied to the washing machine.
-   `source`: `samsung_washer_pk`
-   Initial review status: `UNREVIEWED`

Repair steps, in order:

1.  `USER_SAFE`, `EASY`: Check that the water supply taps are fully
    open.
2.  `USER_SAFE`, `EASY`: Check that the water supply hoses are not
    kinked, clogged, or frozen.
3.  `USER_SAFE`, `EASY`: Confirm that the household water supply has
    sufficient pressure.
4.  `USER_SAFE`, `EASY`: Confirm that hot and cold supply hoses are
    connected to the correct taps, if the model uses both.
5.  `USER_SAFE`, `EASY`: If the manufacturer instructions for the model
    permit it, turn off the water supply before disconnecting a hose and
    gently clean the accessible mesh filter. Reconnect securely and
    check for leaks.
6.  `TECHNICIAN_ONLY`, `null`: If the code remains after the documented
    external water-supply checks, stop troubleshooting and contact
    Samsung service.

#### Code: `4E`

-   Same meaning, model scope, source, and repair steps as `4C`.
-   Create a separate `ErrorCode` record because the schema stores the
    displayed code as a unique code string.

#### Code: `5C`

-   `category`: `WASHING_MACHINE`
-   `brand`: `SAMSUNG`
-   `code`: `5C`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Water is not draining from the washing machine.
-   `source`: `samsung_washer_uk`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that the drain hose is not kinked,
    frozen, or visibly blocked.
2.  `USER_SAFE`, `EASY`: Check that the drain hose is positioned
    correctly for the model's drain connection.
3.  `USER_SAFE`, `EASY`: If the user manual identifies a user-accessible
    debris filter, follow that exact manual procedure to inspect and
    clean it. Be aware that residual water may spill.
4.  `TECHNICIAN_ONLY`, `null`: If the code remains after the permitted
    hose/filter checks, contact Samsung service.

#### Code: `5E`

-   Same meaning, scope, source, and repair steps as `5C`.
-   Create a separate `ErrorCode` record.

#### Code: `dC`

-   `category`: `WASHING_MACHINE`
-   `brand`: `SAMSUNG`
-   `code`: `dC`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: The washer is operating with the door open or the door is
    not properly closed.
-   `source`: `samsung_washer_uk`

Repair steps:

1.  `USER_SAFE`, `EASY`: Open and close the door firmly using the normal
    handle.
2.  `USER_SAFE`, `EASY`: Check that laundry is not trapped between the
    door and door seal.
3.  `TECHNICIAN_ONLY`, `null`: If the door closes correctly but the code
    persists, contact Samsung service; do not bypass the door interlock.

#### Code: `dE`

-   Same meaning, scope, source, and repair steps as `dC`.
-   Create a separate `ErrorCode` record.

#### Code: `Ub`

-   `category`: `WASHING_MACHINE`
-   `brand`: `SAMSUNG`
-   `code`: `Ub`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: The washer cannot spin properly because the laundry load
    is unbalanced.
-   `source`: `samsung_washer_uk`

Repair steps:

1.  `USER_SAFE`, `EASY`: Pause the cycle and redistribute laundry evenly
    around the drum.
2.  `USER_SAFE`, `EASY`: Check that the washer is standing on a flat,
    stable surface.
3.  `USER_SAFE`, `EASY`: If washing a single bulky item, follow the
    model manual's load-balancing advice; do not exceed the rated load.
4.  `TECHNICIAN_ONLY`, `null`: If the code repeatedly appears with a
    balanced load and level machine, contact Samsung service.

#### Code: `UE`

-   Same meaning, scope, source, and repair steps as `Ub`.
-   Create a separate `ErrorCode` record.

#### Code: `OC`

-   `category`: `WASHING_MACHINE`
-   `brand`: `SAMSUNG`
-   `code`: `OC`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: The washer has detected an overflow condition.
-   `source`: `samsung_washer_uk`

Repair steps:

1.  `USER_SAFE`, `EASY`: Stop the cycle. Do not continue adding water or
    detergent.
2.  `TECHNICIAN_ONLY`, `null`: If water continues entering, water is
    leaking, or the code remains, stop using the washer and contact
    Samsung service. Do not open the cabinet or work on
    valves/electrical parts.

#### Code: `OE`

-   Same meaning, scope, source, and repair steps as `OC`.
-   Create a separate `ErrorCode` record.

#### Code: `OF`

-   Same meaning, scope, source, and repair steps as `OC`.
-   Create a separate `ErrorCode` record.

------------------------------------------------------------------------

### 3.2 LG

**Source:** `lg_washer_topload` for top-load-specific records. The
source explicitly says codes vary by model. Use `modelScope: "TOP_LOAD"`
and only serve after confirming the appliance is in the supported
top-load family and the exact model's manual does not contradict the
guide.

#### Code: `IE`

-   `category`: `WASHING_MACHINE`
-   `brand`: `LG`
-   `code`: `IE`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Inlet error; the washer is not receiving water correctly.
-   `source`: `lg_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Confirm the water tap is fully open and the
    household water supply is available.
2.  `USER_SAFE`, `EASY`: Check the inlet hose for kinks or visible
    damage.
3.  `USER_SAFE`, `EASY`: If the exact model manual permits it, turn off
    the water supply and clean the user-accessible inlet filter.
4.  `TECHNICIAN_ONLY`, `null`: If water supply and hose checks do not
    resolve the error, contact LG service.

#### Code: `OE`

-   `category`: `WASHING_MACHINE`
-   `brand`: `LG`
-   `code`: `OE`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Outlet/drainage error.
-   `source`: `lg_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that the drain hose is not kinked,
    blocked, or installed contrary to the model manual.
2.  `USER_SAFE`, `EASY`: Check for a visible obstruction at the
    accessible drain outlet without dismantling the appliance.
3.  `TECHNICIAN_ONLY`, `null`: If drainage remains blocked, contact LG
    service; do not open the pump or electrical compartment.

#### Code: `UE`

-   `category`: `WASHING_MACHINE`
-   `brand`: `LG`
-   `code`: `UE`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Unbalanced load error.
-   `source`: `lg_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Pause the washer and redistribute the laundry
    evenly.
2.  `USER_SAFE`, `EASY`: Check that the appliance is level and stable.
3.  `TECHNICIAN_ONLY`, `null`: If the error persists with a balanced
    load and level appliance, request service.

#### Code: `dE`

-   `category`: `WASHING_MACHINE`
-   `brand`: `LG`
-   `code`: `dE`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Door/lid error.
-   `source`: `lg_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Close the door or lid fully and check that
    laundry is not obstructing it.
2.  `TECHNICIAN_ONLY`, `null`: If the door/lid is closed but the error
    remains, contact LG service. Never bypass the door/lid lock.

#### Code: `LE`

-   `category`: `WASHING_MACHINE`
-   `brand`: `LG`
-   `code`: `LE`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Motor-stuck/rotation error in the cited LG top-load
    guide.
-   `source`: `lg_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Stop the cycle. If the model's user guide
    permits inspection of the wash plate/drum area, check only for a
    clearly visible loose coin or foreign object while the appliance is
    off.
2.  `TECHNICIAN_ONLY`, `null`: If there is no visible accessible
    obstruction, or the drum remains unable to rotate, contact LG
    service. Do not access motor wiring or internal drive components.

#### Code: `LE1`

-   Same meaning, scope, source, and repair steps as `LE`.
-   Create a separate `ErrorCode` record.

#### Code: `FE`

-   `category`: `WASHING_MACHINE`
-   `brand`: `LG`
-   `code`: `FE`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Overfill error.
-   `source`: `lg_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Stop the cycle. If water continues entering,
    close the household water taps.
2.  `TECHNICIAN_ONLY`, `null`: Contact LG service. Do not open the
    cabinet or attempt to repair the inlet valve or pressure system.

#### Code: `tE`

-   `category`: `WASHING_MACHINE`
-   `brand`: `LG`
-   `code`: `tE`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Temperature-sensor error.
-   `source`: `lg_washer_topload`

Repair steps:

1.  `TECHNICIAN_ONLY`, `null`: Stop troubleshooting and request LG
    service inspection. Do not access or replace internal temperature
    sensors.

**Additional LG reference:** `lg_washer_common` lists common LG washer
codes, but its regional/model applicability must be checked before
adding records beyond the top-load family above.

------------------------------------------------------------------------

### 3.3 Whirlpool

**Source:** `whirlpool_washer_frontload`. This is explicitly for
Whirlpool front-load washers. Use `modelScope: "FRONT_LOAD"` and verify
the exact model's manual before approval.

#### Code: `F8 E1`

-   `category`: `WASHING_MACHINE`
-   `brand`: `WHIRLPOOL`
-   `code`: `F8 E1`
-   `modelScope`: `FRONT_LOAD`
-   `meaning`: Low water flow / washer is not detecting sufficient water
    supply.
-   `source`: `whirlpool_washer_frontload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Confirm the household water supply is on and
    both hot and cold taps are fully open where the model uses both.
2.  `USER_SAFE`, `EASY`: Check the inlet hoses for kinks.
3.  `USER_SAFE`, `EASY`: Check that the installation does not use an
    incompatible flood-safe hose/device, as described by the
    manufacturer.
4.  `TECHNICIAN_ONLY`, `null`: If the supply is correct and the error
    persists, contact Whirlpool service.

#### Code: `LO FL`

-   Same meaning, scope, source, and repair steps as `F8 E1`.
-   Create a separate `ErrorCode` record because Whirlpool lists this as
    an alternate displayed code.

#### Code: `F9 E1`

-   `category`: `WASHING_MACHINE`
-   `brand`: `WHIRLPOOL`
-   `code`: `F9 E1`
-   `modelScope`: `FRONT_LOAD`
-   `meaning`: Drain time is longer than expected.
-   `source`: `whirlpool_washer_frontload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that the drain hose is not kinked or
    clogged.
2.  `USER_SAFE`, `EASY`: Check drain-hose installation and height
    against the exact model's installation manual.
3.  `USER_SAFE`, `EASY`: Use only the detergent type and quantity
    specified by Whirlpool for the model; excessive suds can delay
    draining.
4.  `TECHNICIAN_ONLY`, `null`: If the drain path is clear and the code
    remains, contact Whirlpool service.

#### Code: `F7 E1`

-   `category`: `WASHING_MACHINE`
-   `brand`: `WHIRLPOOL`
-   `code`: `F7 E1`
-   `modelScope`: `FRONT_LOAD`
-   `meaning`: Motor speed sensing error; motor is not achieving the
    expected speed.
-   `source`: `whirlpool_washer_frontload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that the washer is not overloaded.
2.  `USER_SAFE`, `EASY`: If the washer was recently installed, check the
    installation instructions to confirm shipping bolts were removed.
3.  `TECHNICIAN_ONLY`, `null`: If the code persists, contact Whirlpool
    service. Do not inspect motor wiring or internal drive components.

#### Code: `F8 E2`

-   `category`: `WASHING_MACHINE`
-   `brand`: `WHIRLPOOL`
-   `code`: `F8 E2`
-   `modelScope`: `FRONT_LOAD`
-   `meaning`: Dispenser-system problem on select models.
-   `source`: `whirlpool_washer_frontload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Inspect the user-removable detergent
    drawer/cartridge for visible detergent buildup.
2.  `USER_SAFE`, `EASY`: Clean the removable dispenser part only as
    described in the model manual.
3.  `TECHNICIAN_ONLY`, `null`: If the error persists, contact Whirlpool
    service.

#### Code: `F5 E2`

-   `category`: `WASHING_MACHINE`
-   `brand`: `WHIRLPOOL`
-   `code`: `F5 E2`
-   `modelScope`: `FRONT_LOAD`
-   `meaning`: Door will not lock.
-   `source`: `whirlpool_washer_frontload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Cancel the cycle using the normal controls.
2.  `USER_SAFE`, `EASY`: Check that the door is fully closed and that
    laundry or another object is not preventing the latch from engaging.
3.  `TECHNICIAN_ONLY`, `null`: If the door still will not lock, contact
    Whirlpool service. Do not bypass or dismantle the door lock.

------------------------------------------------------------------------

### 3.4 Bosch

**Sources:** `bosch_washer_errors` and `bosch_washer_manual`. Bosch code
interpretation can depend on model. Use `modelScope: "UNSPECIFIED"`
unless the seed is tied to a specific Bosch manual/model after
verification.

#### Code: `E17`

-   `category`: `WASHING_MACHINE`
-   `brand`: `BOSCH`
-   `code`: `E17`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Water inlet problem; water tap may be off, hose kinked,
    inlet filter blocked, or water pressure too low.
-   `source`: `bosch_washer_errors`

Repair steps:

1.  `USER_SAFE`, `EASY`: Confirm that the water tap is fully open.
2.  `USER_SAFE`, `EASY`: Check the inlet hose for kinks or pinching.
3.  `USER_SAFE`, `EASY`: Follow the exact Bosch manual to turn off the
    tap and clean the accessible inlet filter. Do not immerse an
    AquaStop safety device in water.
4.  `TECHNICIAN_ONLY`, `null`: If water pressure is inadequate or the
    error persists, contact Bosch service or a qualified plumber as
    appropriate.

#### Code: `F17`

-   Same meaning and steps as `E17`, from `bosch_washer_errors`.
-   Create a separate `ErrorCode` record.

#### Code: `F29`

-   Same meaning and steps as `E17`, from `bosch_washer_errors`.
-   Create a separate `ErrorCode` record.

#### Code: `E18`

-   `category`: `WASHING_MACHINE`
-   `brand`: `BOSCH`
-   `code`: `E18`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Drainage hose/pump path is blocked or kinked; some Bosch
    manuals also identify excess/non-HE detergent as a possible
    contributor.
-   `source`: `bosch_washer_errors`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that the external drain hose is not
    kinked or visibly blocked.
2.  `USER_SAFE`, `EASY`: Use only the detergent type and quantity
    specified by the exact model's manual.
3.  `TECHNICIAN_ONLY`, `null`: Pump maintenance can involve residual hot
    water and appliance access. Only guide the user through it if the
    exact model's manual explicitly defines it as user maintenance;
    otherwise contact Bosch service.

#### Code: `F18`

-   Same meaning and steps as `E18`, from `bosch_washer_errors`.
-   Create a separate `ErrorCode` record.

#### Code: `E16`

-   `category`: `WASHING_MACHINE`
-   `brand`: `BOSCH`
-   `code`: `E16`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Door is not closed properly.
-   `source`: `bosch_washer_manual`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that laundry is not caught in the washer
    door.
2.  `USER_SAFE`, `EASY`: Close the door securely using the normal
    handle.
3.  `TECHNICIAN_ONLY`, `null`: If the door still will not close or the
    code persists, contact Bosch service. Do not bypass the door lock.

------------------------------------------------------------------------

### 3.5 Haier

**Sources:** `haier_washer_topload`, `haier_washer_e4_pk`,
`haier_washer_e1_pk`. Haier codes are model/series-dependent. Use
`TOP_LOAD` only for the cited top-load troubleshooting page; the
Pakistan E1 page is associated with a specific model family and should
be separately reviewed before broader reuse.

#### Code: `E1`

-   `category`: `WASHING_MACHINE`
-   `brand`: `HAIER`
-   `code`: `E1`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Drainage problem; drain hose may be blocked, pressed,
    incorrectly positioned, or too long.
-   `source`: `haier_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that the external drain hose is not
    blocked, crushed, or kinked.
2.  `USER_SAFE`, `EASY`: Check the drain-hose installation height and
    routing against the exact model's manual. Haier's cited top-load
    page specifies a drain outlet height below 10 cm for the described
    model family; do not apply this measurement to other models without
    verification.
3.  `TECHNICIAN_ONLY`, `null`: If the hose is clear and correctly
    installed but the machine still will not drain, contact Haier
    service.

#### Code: `E2`

-   `category`: `WASHING_MACHINE`
-   `brand`: `HAIER`
-   `code`: `E2`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Top lid is not closed.
-   `source`: `haier_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Close the top lid fully.
2.  `USER_SAFE`, `EASY`: Press Start/Pause once more as described by
    Haier.
3.  `TECHNICIAN_ONLY`, `null`: If the lid is closed but the code
    remains, contact Haier service. Do not bypass the lid lock.

#### Code: `E3`

-   `category`: `WASHING_MACHINE`
-   `brand`: `HAIER`
-   `code`: `E3`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Washer does not spin because the laundry may be
    unbalanced or the machine may not be level.
-   `source`: `haier_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Redistribute the laundry evenly.
2.  `USER_SAFE`, `EASY`: Check that the washer is level and stable.
3.  `TECHNICIAN_ONLY`, `null`: If the error persists with a balanced
    load and level machine, contact Haier service.

#### Code: `E4`

-   `category`: `WASHING_MACHINE`
-   `brand`: `HAIER`
-   `code`: `E4`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Water inlet failure on the cited Haier top-load support
    guide.
-   `source`: `haier_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Confirm that the water tap is open and water
    supply/pressure is normal.
2.  `USER_SAFE`, `EASY`: Check that the inlet hose is not kinked.
3.  `USER_SAFE`, `EASY`: If the exact model's manual permits it, turn
    off the water supply and inspect/clean the accessible inlet filter.
4.  `TECHNICIAN_ONLY`, `null`: If the inlet valve remains blocked or the
    code persists, contact Haier service.

#### Code: `FA`

-   `category`: `WASHING_MACHINE`
-   `brand`: `HAIER`
-   `code`: `FA`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Water-level sensor failure.
-   `source`: `haier_washer_topload`

Repair steps:

1.  `TECHNICIAN_ONLY`, `null`: Contact Haier customer care/service. Do
    not open the cabinet or inspect sensor wiring.

#### Code: `FC2`

-   `category`: `WASHING_MACHINE`
-   `brand`: `HAIER`
-   `code`: `FC2`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Communication failure between display board and power
    board.
-   `source`: `haier_washer_topload`

Repair steps:

1.  `TECHNICIAN_ONLY`, `null`: Stop troubleshooting and contact Haier
    service. Do not open the control panel or attempt board/wiring
    repairs.

#### Code: `F2`

-   `category`: `WASHING_MACHINE`
-   `brand`: `HAIER`
-   `code`: `F2`
-   `modelScope`: `TOP_LOAD`
-   `meaning`: Water has reached a critical level.
-   `source`: `haier_washer_topload`

Repair steps:

1.  `USER_SAFE`, `EASY`: Stop the cycle. If water continues entering,
    close the household water tap.
2.  `TECHNICIAN_ONLY`, `null`: Contact Haier service. Do not open the
    appliance or attempt valve/sensor repairs.

**Model-specific Haier note:** Haier Pakistan's E1 page references a
particular model, `HWM60-12699NZP`, and provides
installation-height/blocked-hose troubleshooting. Do not broaden those
exact measurements to every Haier top-load washer. If you add a separate
model-scoped record for that model, use the exact model identifier as
`modelScope` only after confirming it is the correct model string from
the manufacturer page/manual.

------------------------------------------------------------------------

## 4. Refrigerator records

### 4.1 Samsung

**Source:** `samsung_fridge_us`. Samsung explicitly warns not to unplug
the refrigerator or manipulate its panel unless the specific
instructions direct the user to do so. The source covers multiple
refrigerator models; use `modelScope: "UNSPECIFIED"` and do not
wildcard-match.

#### Code: `21E`

-   `category`: `REFRIGERATOR`
-   `brand`: `SAMSUNG`
-   `code`: `21E`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Freezer fan error; the fan may be obstructed by frost,
    the door/gasket may have allowed warm air in, or the fan motor may
    have failed.
-   `source`: `samsung_fridge_us`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that freezer contents do not prevent the
    door from closing fully.
2.  `USER_SAFE`, `EASY`: Visually check that the door gasket makes
    continuous contact around the door.
3.  `USER_SAFE`, `EASY`: If the exact model's Samsung instructions
    permit defrosting, protect food in suitable cold storage and follow
    those model-specific defrost instructions.
4.  `TECHNICIAN_ONLY`, `null`: If the code persists or fan motor failure
    is suspected, contact Samsung service. Do not remove internal panels
    or work on the fan wiring.

#### Code: `22E`

-   `category`: `REFRIGERATOR`
-   `brand`: `SAMSUNG`
-   `code`: `22E`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Refrigerator compartment fan error.
-   `source`: `samsung_fridge_us`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that the refrigerator door has not been
    left open and that food is not preventing it from closing.
2.  `USER_SAFE`, `EASY`: Follow Samsung's documented procedure for
    applicable models: unplug the refrigerator, leave the doors open for
    a few hours, then reconnect and close the doors. Do this only after
    moving perishable food to safe cold storage.
3.  `TECHNICIAN_ONLY`, `null`: If the code returns, contact Samsung
    service.

#### Code: `22C`

-   Same meaning and steps as `22E`, from `samsung_fridge_us`.
-   Create a separate `ErrorCode` record.

#### Code: `5E`

-   `category`: `REFRIGERATOR`
-   `brand`: `SAMSUNG`
-   `code`: `5E`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Refrigerator defrost sensor error.
-   `source`: `samsung_fridge_us`

Repair steps:

1.  `TECHNICIAN_ONLY`, `null`: Contact Samsung service for diagnosis. Do
    not access or replace internal sensors, wiring, heater, or control
    components.

#### Code: `8E`

-   `category`: `REFRIGERATOR`
-   `brand`: `SAMSUNG`
-   `code`: `8E`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Freezer ice-maker sensor error.
-   `source`: `samsung_fridge_us`

Repair steps:

1.  `TECHNICIAN_ONLY`, `null`: Contact Samsung service. Do not access
    internal sensor wiring or replace components.

#### Code: `14E`

-   `category`: `REFRIGERATOR`
-   `brand`: `SAMSUNG`
-   `code`: `14E`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Ice-maker sensor error.
-   `source`: `samsung_fridge_us`

Repair steps:

1.  `TECHNICIAN_ONLY`, `null`: Contact Samsung service. Do not access
    internal sensor wiring or replace components.

#### Code: `33E`

-   `category`: `REFRIGERATOR`
-   `brand`: `SAMSUNG`
-   `code`: `33E`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Ice-pipe heater error.
-   `source`: `samsung_fridge_us`

Repair steps:

1.  `TECHNICIAN_ONLY`, `null`: Contact Samsung service. Do not access
    the heater, internal wiring, or control components.

#### Code: `83E`

-   `category`: `REFRIGERATOR`
-   `brand`: `SAMSUNG`
-   `code`: `83E`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Compressor abnormal-current detection / voltage or
    power-related error.
-   `source`: `samsung_fridge_us`

Repair steps:

1.  `USER_SAFE`, `EASY`: If there has been a power outage or electrical
    disturbance, note when it happened and whether other household
    devices were affected. Do not open the refrigerator or electrical
    panel.
2.  `TECHNICIAN_ONLY`, `null`: If the code returns, contact Samsung
    service. Do not work on compressor or electrical components.

#### Code: `85E`

-   Same power/voltage-related meaning and steps as `83E`, from
    `samsung_fridge_us`.
-   Create a separate `ErrorCode` record.

#### Code: `86E`

-   Same power/voltage-related meaning and steps as `83E`, from
    `samsung_fridge_us`.
-   Create a separate `ErrorCode` record.

**Samsung refrigerator restriction:** The support page has code-specific
reset instructions for some codes, but it explicitly says not to unplug
or manipulate the panel unless directed. Never attach a generic reset
step to every Samsung refrigerator error.

------------------------------------------------------------------------

### 4.2 LG

**Sources:** `lg_fridge_us_ff` and `lg_fridge_us_fan`. LG notes that
displayed codes can vary by model. Use `modelScope: "UNSPECIFIED"`
unless a specific model/series is confirmed.

#### Code: `Er FF`

-   `category`: `REFRIGERATOR`
-   `brand`: `LG`
-   `code`: `Er FF`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Freezer fan abnormality; frost/ice buildup may prevent
    the freezer fan from turning.
-   `source`: `lg_fridge_us_ff`

Repair steps:

1.  `USER_SAFE`, `EASY`: Move perishable food to another refrigerator or
    an insulated cooler before defrosting.
2.  `USER_SAFE`, `EASY`: Place dry towels around the appliance to
    collect water from melting frost.
3.  `USER_SAFE`, `EASY`: For models covered by the cited LG guide,
    unplug the unit and leave both doors fully open for at least 24
    hours to allow natural defrosting. Do not use a hair dryer, heat
    gun, or other heat source.
4.  `TECHNICIAN_ONLY`, `null`: If the error remains after the documented
    defrost procedure, contact LG service.

#### Code: `E FF`

-   Same meaning and steps as `Er FF`, from `lg_fridge_us_ff`.
-   Create a separate `ErrorCode` record.

#### Code: `F`

-   Same meaning and steps as `Er FF` only in the context of the cited
    LG refrigerator guide.
-   Create a separate record only if the exact model's display/manual
    identifies `F` as this fan error. Do not treat a standalone `F` as
    globally unambiguous.

#### Code: `Er rF`

-   `category`: `REFRIGERATOR`
-   `brand`: `LG`
-   `code`: `Er rF`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Refrigerator-compartment fan abnormality.
-   `source`: `lg_fridge_us_fan`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check that food is not blocking the
    refrigerator air vents and that the door can close fully.
2.  `TECHNICIAN_ONLY`, `null`: LG states that the
    refrigerator-compartment fan abnormality requires product inspection
    if it persists. Contact LG service; do not open internal panels or
    work on the fan motor.

#### Code: `E rF`

-   Same meaning and steps as `Er rF`, from `lg_fridge_us_fan`.
-   Create a separate `ErrorCode` record.

------------------------------------------------------------------------

### 4.3 Whirlpool

**Source:** `whirlpool_fridge_po`. This source is specifically for
French Door Bottom Freezer refrigerator models. Use
`modelScope: "FRENCH_DOOR_BOTTOM_FREEZER"` and do not apply to other
Whirlpool refrigerator families without their own source.

#### Code: `PO`

-   `category`: `REFRIGERATOR`
-   `brand`: `WHIRLPOOL`
-   `code`: `PO`
-   `modelScope`: `FRENCH_DOOR_BOTTOM_FREEZER`
-   `meaning`: Power outage indicator; the refrigerator lost power and
    freezer temperature rose to 18°F (-8°C) or higher.
-   `source`: `whirlpool_fridge_po`

Repair steps:

1.  `USER_SAFE`, `EASY`: Check whether a power outage or interruption
    occurred.
2.  `USER_SAFE`, `EASY`: Check the food's actual temperature and follow
    authoritative food-safety guidance before consuming food that may
    have warmed. Do not assume food is safe just because power has
    returned.
3.  `USER_SAFE`, `EASY`: On models covered by this Whirlpool guide,
    acknowledge the power-outage alert by pressing the control labelled
    `MEASURED FILL` under `Confirm`; verify the exact control layout in
    the model manual.
4.  `TECHNICIAN_ONLY`, `null`: If the refrigerator does not cool
    normally after power is restored, contact Whirlpool service.

**Code spelling:** The manufacturer page displays `PO` (letters P and
O), not `P0` (letter P and zero). Preserve `PO`.

------------------------------------------------------------------------

### 4.4 Bosch

**Source:** `bosch_fridge_errors`. Use `modelScope: "UNSPECIFIED"` until
the exact Bosch refrigerator model is checked against its manual.

#### Code: `E02`

-   `category`: `REFRIGERATOR`
-   `brand`: `BOSCH`
-   `code`: `E02`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Icemaker fault or communication issue in the ice-water
    system controls.
-   `source`: `bosch_fridge_errors`

Repair steps:

1.  `TECHNICIAN_ONLY`, `null`: Bosch documents this as an
    icemaker/control-system fault. Do not open the appliance or work on
    internal wiring/components.
2.  `USER_SAFE`, `EASY`: A power reset is documented by Bosch for the
    models covered by the source: switch the relevant breaker off for 30
    seconds and restore it. Only offer this after confirming the exact
    model's manual permits it and the user can safely operate the
    breaker.
3.  `TECHNICIAN_ONLY`, `null`: If the error remains, contact Bosch
    Customer Support/service.

#### Code: `E03`

-   `category`: `REFRIGERATOR`
-   `brand`: `BOSCH`
-   `code`: `E03`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Dispenser user-interface fault/error.
-   `source`: `bosch_fridge_errors`

Repair steps:

1.  `TECHNICIAN_ONLY`, `null`: Do not dismantle the dispenser or access
    internal controls.
2.  `USER_SAFE`, `EASY`: A power reset is documented by Bosch for the
    models covered by the source: switch the relevant breaker off for 30
    seconds and restore it. Only offer this after confirming the exact
    model's manual permits it and the user can safely operate the
    breaker.
3.  `TECHNICIAN_ONLY`, `null`: If the error remains, contact Bosch
    Customer Support/service.

------------------------------------------------------------------------

### 4.5 Haier

**Source:** `haier_fridge_pk`. Haier explicitly states that refrigerator
codes differ by series and that none of the listed errors can be
resolved by the user. Use `modelScope: "UNSPECIFIED"` and do not
wildcard-match.

#### Codes: `F1`, `F2`, `F3`, `F4`, `F5`, `F6`, `F7`, `F8`, `F9`, `FR`, `Eh`

Create one `ErrorCode` record for each code.

Shared fields:

-   `category`: `REFRIGERATOR`
-   `brand`: `HAIER`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Refrigerator sensor error; exact sensor and diagnosis
    depend on the model/series.
-   `source`: `haier_fridge_pk`

Repair step:

1.  `TECHNICIAN_ONLY`, `null`: Haier states that this sensor error
    cannot be resolved by the user. Stop troubleshooting and contact
    Haier service. Do not open the appliance or attempt sensor, wiring,
    or control-board replacement.

#### Code: `E0`

-   `category`: `REFRIGERATOR`
-   `brand`: `HAIER`
-   `code`: `E0`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Communication error.
-   `source`: `haier_fridge_pk`

Repair step:

1.  `TECHNICIAN_ONLY`, `null`: Contact Haier service for diagnosis. Do
    not open the appliance or work on control boards/wiring.

#### Codes: `E1`, `E2`, `E6`, `E9`

Create one `ErrorCode` record for each code.

Shared fields:

-   `category`: `REFRIGERATOR`
-   `brand`: `HAIER`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Refrigerator fan error; exact fan and cause depend on the
    model/series.
-   `source`: `haier_fridge_pk`

Repair step:

1.  `TECHNICIAN_ONLY`, `null`: Haier states that refrigerator error
    codes require technician service. Do not remove internal panels,
    access fan wiring, or replace a fan.

#### Code: `Er`

-   `category`: `REFRIGERATOR`
-   `brand`: `HAIER`
-   `code`: `Er`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Ice-maker error.
-   `source`: `haier_fridge_pk`

Repair step:

1.  `TECHNICIAN_ONLY`, `null`: Contact Haier service. Do not dismantle
    the ice maker or access internal electrical parts.

#### Codes: `Ec`, `Ed`, `Fd`, `Rd`, `Hd`

Create one `ErrorCode` record for each code.

Shared fields:

-   `category`: `REFRIGERATOR`
-   `brand`: `HAIER`
-   `modelScope`: `UNSPECIFIED`
-   `meaning`: Defrost-system error.
-   `source`: `haier_fridge_pk`

Repair step:

1.  `TECHNICIAN_ONLY`, `null`: Contact Haier service. Do not access the
    defrost heater, internal sensors, wiring, or control board.

**Haier refrigerator warning:** Haier explicitly says its codes differ
by series and none of these errors can be resolved by the user. Do not
invent DIY fixes or a universal reset procedure.

------------------------------------------------------------------------

## 5. Coverage matrix

This is the starter coverage represented in this document. A code record
is not automatically production-approved merely because it appears here.

  -----------------------------------------------------------------------
  Brand                   Washing machine         Refrigerator
  ----------------------- ----------------------- -----------------------
  Samsung                 `4C`, `4E`, `5C`, `5E`, `21E`, `22E`, `22C`,
                          `dC`, `dE`, `Ub`, `UE`, `5E`, `8E`, `14E`,
                          `OC`, `OE`, `OF`        `33E`, `83E`, `85E`,
                                                  `86E`

  LG                      `IE`, `OE`, `UE`, `dE`, `Er FF`, `E FF`, `F`
                          `LE`, `LE1`, `FE`, `tE` (only if model
                                                  confirms), `Er rF`,
                                                  `E rF`

  Whirlpool               `F8 E1`, `LO FL`,       `PO`
                          `F9 E1`, `F7 E1`,       
                          `F8 E2`, `F5 E2`        

  Bosch                   `E17`, `F17`, `F29`,    `E02`, `E03`
                          `E18`, `F18`, `E16`     

  Haier                   `E1`, `E2`, `E3`, `E4`, `F1`--`F9`, `FR`, `Eh`,
                          `FA`, `FC2`, `F2`       `E0`, `E1`, `E2`, `E6`,
                                                  `E9`, `Er`, `Ec`, `Ed`,
                                                  `Fd`, `Rd`, `Hd`
  -----------------------------------------------------------------------

**Important:** Similar code strings across different brands or appliance
categories are separate records. For example, Samsung washing machine
`5E` and Samsung refrigerator `5E` must never be merged; the composite
uniqueness key includes `category`, `brand`, `code`, and `modelScope`.

------------------------------------------------------------------------

## 6. Prisma seed implementation requirements for OpenCode

Implement the seed script against the existing generated Prisma client
and current Prisma 7 configuration. Inspect the repository's current
seed conventions before editing.

### Required creation order

1.  Create or find `KnowledgeSource` records.
2.  Create or find `ErrorCode` records using the composite unique key:
    `category_brand_code_modelScope`.
3.  Create or find `RepairStep` records.
4.  Create or find `ErrorCodeRepairStep` links using the composite
    primary key: `errorCodeId_repairStepId`.

### Idempotency

-   Running the seed twice must not create duplicate sources, error
    codes, repair steps, or join rows.
-   Do not use `deleteMany` to clear knowledge tables.
-   Do not overwrite a record's `reviewStatus` if a reviewer has changed
    it from `UNREVIEWED`.
-   Do not reset approved/rejected records back to `UNREVIEWED` on a
    subsequent seed run.
-   Because `KnowledgeSource` has no unique constraint, find existing
    sources by a stable pair such as `title` + `url`; create only if
    absent.
-   Because `RepairStep` has no natural unique constraint, find existing
    steps by `sourceId` + exact `instruction` + `safetyClass`; create
    only if absent.
-   Use a transaction for logically related records/links where
    appropriate.
-   Do not invent or hard-code UUIDs; use Prisma-generated IDs.
-   If an existing matching code has a different meaning/source, do not
    silently overwrite it. Report the conflict and fail the seed so a
    human can review it.
-   If a matching code exists with the same meaning, reuse it without
    changing its review status.
-   Preserve source attribution on each repair step.

### Data validation

Before writing to Neon, validate in memory:

-   Every `ErrorCode.sourceId` resolves to a `KnowledgeSource`.
-   Every repair step has a source.
-   Every join references an existing error code and repair step.
-   Every code has at least one repair step.
-   `position` values are unique and sequential per error code.
-   All initial review statuses are `UNREVIEWED`.
-   No source kind is `TEST_FIXTURE`.
-   No code has an empty `modelScope`.
-   No `UNSPECIFIED` scope is treated as a wildcard in retrieval.
-   No record claims exact model compatibility without a source
    supporting that model.

### Environment and database safety

-   Never print or commit `DATABASE_URL`, `DIRECT_URL`, JWT secrets, or
    any other secret.
-   Do not change `.env`, Prisma schema, migrations, or production
    database configuration as part of seed implementation.
-   Confirm which Neon branch/database is targeted before running the
    seed.
-   Prefer a development Neon branch first.
-   Print only aggregate counts and non-sensitive validation results.
-   Do not automatically approve records after seeding.

### Expected seed summary

At completion, print counts such as:

-   Knowledge sources created/reused
-   Error codes created/reused
-   Repair steps created/reused
-   Error-code/repair-step links created/reused
-   Conflicts detected
-   All records still `UNREVIEWED`

Do not claim the dataset is production-ready. It is a
manufacturer-sourced starter dataset that requires model-specific review
and approval.

------------------------------------------------------------------------

## 7. Retrieval rules that must be respected later by the Diagnosis API

The future knowledge retrieval service must not return a code just
because its text matches.

A record may be used for user-facing repair guidance only when all of
these conditions are satisfied:

1.  `ErrorCode.reviewStatus === APPROVED`.
2.  The appliance category matches.
3.  The brand matches after consistent normalization.
4.  The error code matches exactly after safe normalization that
    preserves meaningful characters/case.
5.  The appliance's model is confirmed compatible with `modelScope`;
    `UNSPECIFIED` is not a wildcard.
6.  Every linked `ErrorCodeRepairStep.reviewStatus === APPROVED`.
7.  Every linked `RepairStep.reviewStatus === APPROVED`.
8.  Every returned repair step has `safetyClass === USER_SAFE`.
9.  If any linked step is unapproved or technician-only, do not return a
    partial sequence. Escalate to clarification or technician guidance.
10. Re-check the same approval and safety constraints when constructing
    the response sent to Groq.

For codes that have only `TECHNICIAN_ONLY` steps, the diagnosis response
should clearly recommend professional service. Do not pass
hidden/internal repair procedures to Groq.

------------------------------------------------------------------------

## 8. Product-plan alignment

The Product Plan specifies:

-   The user can photograph the model sticker or error display.
-   AI should identify brand, model, and error code.
-   The app must also support symptom-based diagnosis when no code
    exists.
-   The app should ask technician-style follow-up questions.
-   Guidance must be model-specific and step-by-step.
-   The MVP covers washing machines and refrigerators, with Samsung, LG,
    Whirlpool, Bosch, and Haier as the target brands.
-   The app must never suggest opening electrical, gas, or sealed
    refrigerant systems.
-   It must clearly tell users when to call a technician.

This seed dataset covers only error-code knowledge. It does not complete
sticker OCR, symptom diagnosis, follow-up question logic, parts lookup,
repair-cost estimates, or the Diagnosis API.

------------------------------------------------------------------------

## 9. Official manufacturer source references

All links below are manufacturer support pages or manufacturer-hosted
manuals. Use the page relevant to the appliance family and exact model.
A manufacturer page can still cover only a subset of that brand's
products.

### Samsung

-   Washing-machine information codes:
    https://www.samsung.com/uk/support/home-appliances/check-out-the-information-codes-on-my-washing-machine/
-   Pakistan 4C/4E/NF/NF1 water-supply troubleshooting:
    https://www.samsung.com/pk/support/home-appliances/resolve-4c-4e-nf-or-nf1-error-codes-on-your-samsung-washing-machine/
-   Refrigerator error codes:
    https://www.samsung.com/us/support/troubleshoot/TSG10007315/

### LG

-   Top-load washer error-code list:
    https://www.lg.com/us/support/help-library/lg-top-load-washer-error-code-list-CT10000010-20154403824104
-   Common washing-machine error messages:
    https://www.lg.com/eg_en/support/product-support/troubleshoot/help-library/cs-CT52008194-20152666096790/
-   Refrigerator Er FF/E FF/F:
    https://www.lg.com/us/support/help-library/if-you-see-an-er-ff-e-ff-or-f-error-code-on-your-lg-refrigerator--20155452969338
-   Refrigerator E FF/E rF:
    https://www.lg.com/us/support/help-library/lg-refrigerator-troubleshooting-an-e-ff-or-e-rf-error-code--20153150964030

### Whirlpool

-   Front-load washer error codes:
    https://producthelp.whirlpool.com/Laundry/Washers/Product_Info/Washer_Product_Assistance/Error_Codes_in_Front_Load_Washers
-   Refrigerator PO error:
    https://producthelp.whirlpool.com/Refrigeration/Full-Size_Refrigerators/French_Door_Bottom_Freezer_Refrigerator/Control_Concerns/Error_Codes%2C_Blinking%2C_Flashing_Lights/Blinking_Lights/PO_Error_Code\_-\_Refrigerator

### Bosch

-   Washer error codes:
    https://www.bosch-home.com/us/en/c/spotlight/blt341dacb48f00c362/owner-support/error-codes/washers
-   Bosch washer use-and-care manual:
    https://media3.bosch-home.com/Documents/9000825639_D.pdf
-   Refrigerator error codes:
    https://www.bosch-home.com/us/owner-support/error-codes/refrigeration/

### Haier

-   Top-load washer troubleshooting:
    https://www.haier.com/in/service-support/self-service/20240828_249143.shtml
-   Pakistan washer E4 water-inlet error:
    https://www.haier.com/pk/service-support/self-service/20261023_295891.shtml
-   Pakistan washer E1 drainage error:
    https://www.haier.com/pk/service-support/self-service/20261016_295632.shtml
-   Pakistan refrigerator/freezer error codes:
    https://www.haier.com/pk/service-support/self-service/20201208_151095.shtml

------------------------------------------------------------------------

## 10. Final instruction to OpenCode

Read this entire document and inspect the current Prisma schema, package
scripts, generated Prisma client, and existing seed setup. Then
implement an idempotent development seed using only the existing schema.

**Do not change the Prisma schema or create migrations. Do not mark any
record approved. Do not add unsupported codes or repair instructions. Do
not run against production Neon without explicit confirmation.**

After implementation, report the changed files, seed command, aggregate
counts, validation results, and any model-scope/source conflicts that
require human review. Run typecheck and the seed against the development
database only.
