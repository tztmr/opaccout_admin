package com.tencent.mobileqq;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import javax.net.ssl.HttpsURLConnection;

/** HTTPS-only client for resolving a nine-digit OP without logging or persisting its response. */
public final class ShortOpApiClient {
    static final int TIMEOUT_MILLIS = 8_000;
    private static final String PROJECT_KEY = "douyin";
    private static final String PROJECT_NAME = "抖音";
    private static final String PROJECT_APP_ID = "1105602870";
    private static final Set<String> ROOT_FIELDS = Set.of("status", "code", "opData", "project", "expiresAt", "wakeUrl");
    private static final Set<String> PROJECT_FIELDS = Set.of("key", "name", "appId");

    private final URL endpoint;
    private final ConnectionFactory connectionFactory;

    public ShortOpApiClient(String apiBaseUrl) {
        this(apiBaseUrl, url -> (HttpsURLConnection) url.openConnection());
    }

    ShortOpApiClient(String apiBaseUrl, ConnectionFactory connectionFactory) {
        if (connectionFactory == null) throw new IllegalArgumentException("连接工厂不能为空");
        try {
            URI base = new URI(apiBaseUrl == null ? "" : apiBaseUrl.trim());
            if (!"https".equalsIgnoreCase(base.getScheme()) || base.getHost() == null
                || base.getRawQuery() != null || base.getRawFragment() != null || base.getUserInfo() != null) {
                throw new IllegalArgumentException("短 OP API 必须是 HTTPS 地址");
            }
            String path = base.getPath() == null ? "" : base.getPath().replaceAll("/+$", "");
            this.endpoint = new URI("https", null, base.getHost(), base.getPort(), path + "/api/op/resolve", null, null).toURL();
        } catch (URISyntaxException | IOException error) {
            throw new IllegalArgumentException("短 OP API 地址无效");
        }
        this.connectionFactory = connectionFactory;
    }

    public static boolean isShortOp(String value) {
        return value != null && value.matches("^[1-9][0-9]{8}$");
    }

    public ShortOpResponse resolve(String code) throws ResolveException {
        if (!isShortOp(code)) throw new ResolveException(Failure.INVALID);

        HttpURLConnection connection = null;
        try {
            connection = connectionFactory.open(endpoint);
            connection.setConnectTimeout(TIMEOUT_MILLIS);
            connection.setReadTimeout(TIMEOUT_MILLIS);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            byte[] request = ("{\"code\":\"" + code + "\"}").getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(request.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(request);
            }

            int status = connection.getResponseCode();
            if (status == 400 || status == 404) throw new ResolveException(Failure.INVALID);
            if (status == 429) throw new ResolveException(Failure.RATE_LIMITED);
            if (status != 200) throw new ResolveException(Failure.OFFLINE);
            ShortOpResponse response = parse(status, readUtf8(connection.getInputStream()));
            if (!code.equals(response.code())) throw new ResolveException(Failure.INVALID);
            return response;
        } catch (ResolveException error) {
            throw error;
        } catch (SocketTimeoutException error) {
            throw new ResolveException(Failure.TIMEOUT);
        } catch (ConnectException error) {
            throw new ResolveException(Failure.OFFLINE);
        } catch (IOException error) {
            throw new ResolveException(Failure.OFFLINE);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static ShortOpResponse parse(int status, String body) throws ResolveException {
        if (status == 400 || status == 404) throw new ResolveException(Failure.INVALID);
        if (status == 429) throw new ResolveException(Failure.RATE_LIMITED);
        if (status != 200) throw new ResolveException(Failure.OFFLINE);
        try {
            Map<String, Object> root = new JsonReader(body).object();
            requireExactFields(root, ROOT_FIELDS);
            requireEquals("success", value(root, "status"));
            String code = value(root, "code");
            String opData = value(root, "opData");
            String expiresAt = value(root, "expiresAt");
            String wakeUrl = value(root, "wakeUrl");
            if (!isShortOp(code) || !isValidOpData(opData)) throw invalid();
            try {
                Instant.parse(expiresAt);
            } catch (DateTimeParseException error) {
                throw invalid();
            }
            Object projectValue = root.get("project");
            if (!(projectValue instanceof Map<?, ?>)) throw invalid();
            @SuppressWarnings("unchecked") Map<String, Object> project = (Map<String, Object>) projectValue;
            requireExactFields(project, PROJECT_FIELDS);
            requireEquals(PROJECT_KEY, value(project, "key"));
            requireEquals(PROJECT_NAME, value(project, "name"));
            requireEquals(PROJECT_APP_ID, value(project, "appId"));
            validateWakeUrl(wakeUrl);
            return new ShortOpResponse(code, opData, wakeUrl);
        } catch (ResolveException error) {
            throw error;
        } catch (RuntimeException error) {
            throw invalid();
        }
    }

    private static void validateWakeUrl(String wakeUrl) throws ResolveException {
        try {
            URI uri = new URI(wakeUrl);
            if (!("tencent" + PROJECT_APP_ID).equals(uri.getScheme())
                || !"qzapp".equals(uri.getHost())
                || !"/mqzone/0".equals(uri.getPath())
                || uri.getRawQuery() == null || uri.getRawFragment() != null) {
                throw invalid();
            }
        } catch (URISyntaxException error) {
            throw invalid();
        }
    }

    private static boolean isValidOpData(String opData) {
        if (opData == null || !opData.equals(opData.trim())) return false;
        String[] parts = opData.split("\\|", -1);
        if (parts.length < 3 || parts.length > 5) return false;
        for (String part : parts) if (part.isEmpty() || !part.equals(part.trim())) return false;
        return true;
    }

    private static String readUtf8(InputStream input) throws IOException {
        if (input == null) throw new IOException("empty response stream");
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int count;
            while ((count = source.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8);
        }
    }

    private static String value(Map<String, Object> object, String key) throws ResolveException {
        Object value = object.get(key);
        if (!(value instanceof String) || ((String) value).isEmpty()) throw invalid();
        return (String) value;
    }

    private static void requireExactFields(Map<String, Object> object, Set<String> fields) throws ResolveException {
        if (!object.keySet().equals(fields)) throw invalid();
    }

    private static void requireEquals(String expected, String actual) throws ResolveException {
        if (!expected.equals(actual)) throw invalid();
    }

    private static ResolveException invalid() { return new ResolveException(Failure.INVALID); }

    interface ConnectionFactory {
        HttpURLConnection open(URL url) throws IOException;
    }

    enum Failure { INVALID, RATE_LIMITED, TIMEOUT, OFFLINE }

    static final class ResolveException extends Exception {
        private final Failure failure;
        ResolveException(Failure failure) { this.failure = failure; }
        Failure failure() { return failure; }
    }

    /** Tiny strict JSON object reader for this fixed response schema; it accepts no arrays or numbers. */
    private static final class JsonReader {
        private final String source;
        private int position;

        JsonReader(String source) { this.source = source == null ? "" : source; }

        Map<String, Object> object() {
            Map<String, Object> result = objectInternal();
            whitespace();
            if (position != source.length()) throw new IllegalArgumentException("trailing JSON");
            return result;
        }

        private Map<String, Object> objectInternal() {
            expect('{');
            Map<String, Object> result = new LinkedHashMap<>();
            whitespace();
            if (consume('}')) return result;
            while (true) {
                String key = string();
                if (result.containsKey(key)) throw new IllegalArgumentException("duplicate JSON key");
                expect(':');
                whitespace();
                Object value = peek() == '{' ? objectInternal() : string();
                result.put(key, value);
                whitespace();
                if (consume('}')) return result;
                expect(',');
            }
        }

        private String string() {
            whitespace();
            expect('"');
            StringBuilder value = new StringBuilder();
            while (position < source.length()) {
                char current = source.charAt(position++);
                if (current == '"') return value.toString();
                if (current < 0x20) throw new IllegalArgumentException("control character in JSON string");
                if (current != '\\') {
                    value.append(current);
                    continue;
                }
                if (position >= source.length()) throw new IllegalArgumentException("unfinished JSON escape");
                char escape = source.charAt(position++);
                switch (escape) {
                    case '"': value.append('"'); break;
                    case '\\': value.append('\\'); break;
                    case '/': value.append('/'); break;
                    case 'b': value.append('\b'); break;
                    case 'f': value.append('\f'); break;
                    case 'n': value.append('\n'); break;
                    case 'r': value.append('\r'); break;
                    case 't': value.append('\t'); break;
                    case 'u':
                        if (position + 4 > source.length()) throw new IllegalArgumentException("short unicode escape");
                        value.append((char) Integer.parseInt(source.substring(position, position + 4), 16));
                        position += 4;
                        break;
                    default: throw new IllegalArgumentException("invalid JSON escape");
                }
            }
            throw new IllegalArgumentException("unterminated JSON string");
        }

        private void expect(char expected) {
            whitespace();
            if (position >= source.length() || source.charAt(position++) != expected) throw new IllegalArgumentException("invalid JSON");
        }

        private boolean consume(char expected) {
            whitespace();
            if (position < source.length() && source.charAt(position) == expected) {
                position += 1;
                return true;
            }
            return false;
        }

        private char peek() {
            whitespace();
            if (position >= source.length()) throw new IllegalArgumentException("unexpected end of JSON");
            return source.charAt(position);
        }

        private void whitespace() {
            while (position < source.length() && Character.isWhitespace(source.charAt(position))) position += 1;
        }
    }
}
