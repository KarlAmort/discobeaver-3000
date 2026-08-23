# just: "mirror the Vidstack CDN bundle into public/vidstack so it's served same-origin (the user's
#        Safari/network denies cross-origin module scripts). Downloads the entry + every chunk it
#        transitively imports, rewriting absolute jsdelivr chunk URLs to same-origin /vidstack paths."
require "net/http"
require "uri"
require "fileutils"

ENTRY  = "https://cdn.vidstack.io/player"
CHUNKS = %r{https://cdn\.jsdelivr\.net/npm/@vidstack/cdn@[0-9.]+/chunks/([A-Za-z0-9_.\-]+\.js)}
OTHER  = %r{https://cdn\.jsdelivr\.net/npm/[^"')\s]+}   # any other absolute jsdelivr import (flag it)

root = File.expand_path("../public/vidstack", __dir__)
FileUtils.mkdir_p(File.join(root, "chunks"))

def fetch(url)
   uri = URI(url)
   Net::HTTP.get_response(uri).tap { |r| raise "HTTP #{r.code} for #{url}" unless r.is_a?(Net::HTTPSuccess) }.body
end

# rewrite absolute @vidstack chunk URLs -> /vidstack/chunks/NAME (same-origin)
def rewrite(body)
   body.gsub(CHUNKS) { "/vidstack/chunks/#{Regexp.last_match(1)}" }
end

seen = {}
queue = [ [ ENTRY, File.join(root, "player.js") ] ]
other_imports = []

until queue.empty?
   url, dest = queue.shift
   next if seen[url]
   seen[url] = true
   body = fetch(url)
   # discover chunk deps BEFORE rewrite (need the original absolute URLs)
   body.scan(CHUNKS) do |name,|
      cu = url.sub(%r{/[^/]+$}, "")  # not used; chunks are absolute jsdelivr
   end
   body.scan(/https:\/\/cdn\.jsdelivr\.net\/npm\/@vidstack\/cdn@[0-9.]+\/chunks\/[A-Za-z0-9_.\-]+\.js/).uniq.each do |curl|
      name = curl[%r{chunks/([A-Za-z0-9_.\-]+\.js)}, 1]
      queue << [ curl, File.join(root, "chunks", name) ] unless seen[curl]
   end
   # flag any non-vidstack jsdelivr imports (would still be cross-origin)
   body.scan(OTHER).reject { |u| u.include?("@vidstack/cdn") }.each { |u| other_imports << u }
   File.write(dest, rewrite(body))
   print "."
end

puts "\nvendored #{seen.size} files into public/vidstack/"
unless other_imports.uniq.empty?
   puts "WARNING: other absolute jsdelivr imports still present (cross-origin):"
   puts other_imports.uniq.first(20)
end
