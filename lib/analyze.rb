# frozen_string_literal: true

require "3000"
require "fileutils"
require "json"
require "set"
require "time"
require "uri"

module ChapterEleventy
   ROOT = File.expand_path("..", __dir__)
   TARGET = File.join(ROOT, "analysis")
   MINIMUM = 60 * 60
   BUDGET_MS = 30_000
   ORIGINS = {
      "okru" => "https://ok.ru",
      "tokyomotion" => "https://www.tokyomotion.net"
   }.freeze

   module_function

   def cell(value)
      value.to_s.gsub("|", "\\|").gsub(/[\r\n]+/, " ").gsub(/\A[[:space:]]+|[[:space:]]+\z/, "")
   end

   def locator(value)
      text = cell(value)
      return "—" if text.empty?

      "`#{text}`"
   end

   def clock(seconds)
      value = seconds.to_i
      format("%d:%02d:%02d", value / 3600, value / 60 % 60, value % 60)
   end

   def uri(data)
      value = data[:webpage_url].to_s.empty? ? data[:source_uri].to_s : data[:webpage_url].to_s
      return URI::DEFAULT_PARSER.escape(value) if value.match?(%r{\A[a-z][a-z0-9+.-]*:}i)

      origin = ORIGINS[data[:provider]]
      origin ? "#{origin}#{URI::DEFAULT_PARSER.escape(value.start_with?("/") ? value : "/#{value}")}" : nil
   end

   def record(video)
      data = {
         id: video.id,
         title: video.display_title,
         duration: video.duration.to_f,
         provider: video.provider,
         source_uri: video.source_uri,
         webpage_url: video.webpage_url,
         width: video.pixel_width,
         height: video.pixel_height,
         fps: video.fps,
         bitrate: video.video_bitrate,
         filesize: video.filesize,
         rating: video.our_rating,
         views: video.view_count,
         description: video.description,
         tags: Array(video.tags),
         vision: video.vision_caption_data
      }
      data[:uri] = uri(data)
      data
   end

   def markdown(data)
      title = data[:title].to_s.strip.empty? ? data[:source_uri] : data[:title]
      source = data[:uri]
      resolution = data[:width] && data[:height] ? "#{data[:width]}×#{data[:height]}" : "—"
      payload = { kind: "video" }
      payload[:uri] = source if source
      payload.merge!(
         local: "video/#{data[:id]}/stream",
         original: {
            element: "video",
            attributes: { controls: "", preload: "metadata", src: "video/#{data[:id]}/stream" },
            label: title
         }
      )
      lines = [
         "---",
         "title: #{JSON.generate(title)}",
         "lang: en",
         "nav: #{data[:id]}.md index.md videos.json",
         "root: /tuf-tuf-tufte-3000",
         "---",
         "",
         "| measure | value |",
         "| --- | --- |",
         "| ID | #{data[:id]} |",
         "| duration | #{clock(data[:duration])} |",
         "| provider | #{cell(data[:provider] || '—')} |",
         "| source locator | #{locator(data[:source_uri])} |",
         "| source | #{source ? '[source][source]' : '—'} |",
         "| resolution | #{resolution} |",
         "| rating | #{data[:rating] || '—'} |",
         "| views | #{data[:views] || '—'} |",
         "",
         "```embed",
         JSON.generate(payload),
         "```",
         ""
      ]
      vision = data[:vision].is_a?(Hash) ? data[:vision] : {}
      scene = vision["scene"].is_a?(Hash) ? vision["scene"] : {}
      unless scene.empty?
         lines << "## #{scene.length} scene observations"
         lines << ""
         scene.each { |key, value| lines << "- #{key.tr('_', ' ')}: #{cell(value)}" unless value.to_s.empty? }
         lines << ""
      end
      persons = vision["persons"].is_a?(Array) ? vision["persons"] : []
      unless persons.empty?
         lines << "## #{persons.length} #{persons.length == 1 ? 'person' : 'persons'}"
         lines << ""
         persons.each_with_index do |person, index|
            facts = person.to_h.filter_map { |key, value| "#{key.tr('_', ' ')}: #{cell(value)}" unless value.to_s.empty? }
            lines << "#{index + 1}. #{facts.join('; ')}"
         end
         lines << ""
      end
      lines << "[source]: #{source}" if source
      "#{lines.join("\n")}\n"
   end

   def persist(data)
      source = markdown(data)
      html = TufTufTufte3000::Markdown.page(source)
      md = File.join(TARGET, "#{data[:id]}.md")
      page = File.join(TARGET, "#{data[:id]}.html")
      File.write(md, source) unless File.file?(md) && File.read(md) == source
      File.write(page, html) unless File.file?(page) && File.read(page) == html
      raise "missing video player" unless html.include?(%(<video controls src="video/#{data[:id]}/stream"))
   rescue StandardError => error
      Fireservice.error("[chapter.error][analysis] video failed: #{error.class}: #{error.message}", subsystem: "chapter")
      raise
   end

   def index(records, generated)
      lines = [
         "---",
         "title: #{records.length} videos over 60 minutes",
         "lang: en",
         "nav: index.md videos.json",
         "root: /tuf-tuf-tufte-3000",
         "---",
         "",
         "| measure | value |",
         "| --- | ---: |",
         "| generated | #{generated} |",
         "| videos | #{records.length} |",
         "| hours | #{(records.sum { _1[:duration] } / 3600).round} |",
         "",
         *records.map { |video| "- [#{cell(video[:title])}](#{video[:id]}.html) · #{clock(video[:duration])} · #{cell(video[:provider] || '—')}" },
         ""
      ]
      source = "#{lines.join("\n")}\n"
      File.write(File.join(TARGET, "index.md"), source)
      File.write(File.join(TARGET, "index.html"), TufTufTufte3000::Markdown.page(source))
   end

   def prune(records)
      keep = records.flat_map { |record| [ "#{record[:id]}.md", "#{record[:id]}.html" ] }.to_set
      Dir.glob(File.join(TARGET, "*.{md,html}")) do |path|
         name = File.basename(path)
         File.delete(path) unless name == "index.md" || name == "index.html" || keep.include?(name)
      end
   end

   def run
      limit = Integer(ENV.fetch("CHAPTER_LIMIT", "0"))
      scope = Video.where("duration > ?", MINIMUM).order(duration: :desc, id: :asc)
      scope = scope.limit(limit) if limit.positive?
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      FileUtils.mkdir_p(TARGET)
      records = []
      Fireservice.guard("analysis", budget_ms: BUDGET_MS, subsystem: "chapter") do
         scope.each do |video|
            data = record(video)
            persist(data)
            records << data
         end
      end
      generated = Time.now.iso8601
      File.write(File.join(TARGET, "videos.json"), "#{JSON.pretty_generate(records)}\n")
      index(records, generated)
      prune(records) unless limit.positive?
      elapsed = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
      Fireservice.info("[chapter.done] analysis complete: #{records.length} videos in #{elapsed}ms",
         subsystem: "chapter", "videos.count" => records.length, "duration.ms" => elapsed)
   end
end

ChapterEleventy.run
