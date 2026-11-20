#pragma once
#include "whole-build.hpp"

namespace fgmr {
// Enrich a validated BuildWholeObject baseline with a locally imported R07
// candidate. This extracts the bounded box-union grammar; Core owns evaluation.
WholeBuildResult fitted_surface(WholeBuildResult baseline, WholeBuildSource input);
}
