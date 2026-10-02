require "pathname"

source "https://rubygems.org"

ruby ">=4.1.0.dev"

gem "discobeaver-3000", path: Pathname.new(ENV.fetch("HOUSE_ROOT", File.expand_path("../3000.amort.berlin", __dir__))).relative_path_from(Pathname.new(__dir__)).to_s

gem "progress-3000", git: "https://github.com/KarlAmort/progress-3000.git", branch: "🦫", require: "progress_3000"

gem "tuf-tuf-tufte-3000", git: "https://github.com/KarlAmort/tuf-tuf-tufte-3000.git", branch: "🦫"
