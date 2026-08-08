package com.tencent.mobileqq;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** Contract tests for the online nine-digit OP resolver. No test opens a network socket. */
public final class ShortOpApiClientTest {
    public static void main(String[] args) throws Exception {
        recognizesOnlyNineDigitNonZeroCodes();
        postsStrictJsonToTheNormalizedHttpsResolveEndpoint();
        parsesOnlyTheExpectedDouyinResponse();
        acceptsOnlyServerIsoInstantShape();
        rejectsUnsafeOrMalformedSuccessResponses();
        mapsPublicApiAndNetworkFailuresWithoutLeakingResponseData();
        rejectsNonHttpsBaseUrls();
        suppressesStaleOrDestroyedShortOpCallbacks();
        System.out.println("Short OP API client contract passed");
    }

    private static void recognizesOnlyNineDigitNonZeroCodes() {
        require(ShortOpApiClient.isShortOp("123456789"), "nine non-zero-leading digits must be a short OP");
        require(!ShortOpApiClient.isShortOp("012345678"), "zero-leading codes must not be short OPs");
        require(!ShortOpApiClient.isShortOp("12345678"), "eight digits must not be short OPs");
        require(!ShortOpApiClient.isShortOp("open|access|pay"), "full OP input must stay offline");
    }

    private static void postsStrictJsonToTheNormalizedHttpsResolveEndpoint() throws Exception {
        FakeConnection connection = new FakeConnection(200, successJson("123456789"));
        ShortOpApiClient client = new ShortOpApiClient("https://resolver.example///", url -> {
            requireEquals("https://resolver.example/api/op/resolve", url.toString(), "endpoint must normalize slash joining");
            return connection;
        });

        ShortOpResponse response = client.resolve("123456789");

        requireEquals("open|access|pay", response.opData(), "successful OP data must reach the caller");
        requireEquals("POST", connection.requestMethod, "resolver must use POST");
        requireEquals("application/json; charset=utf-8", connection.headers.get("Content-Type"), "resolver must send JSON content type");
        requireEquals("application/json", connection.headers.get("Accept"), "resolver must accept JSON only");
        requireEquals(8000, connection.connectTimeout, "connection timeout must be eight seconds");
        requireEquals(8000, connection.readTimeout, "read timeout must be eight seconds");
        requireEquals("{\"code\":\"123456789\"}", connection.requestBody(), "resolver must send only the strict short-code payload");
    }

    private static void parsesOnlyTheExpectedDouyinResponse() throws Exception {
        ShortOpResponse response = ShortOpApiClient.parse(200, successJson("123456789"));
        requireEquals("123456789", response.code(), "response code must be preserved");
        requireEquals("open|access|pay", response.opData(), "response OP data must be preserved");
        requireEquals("tencent1105602870://qzapp/mqzone/0?objectlocation=url&pasteboard=fixture", response.wakeUrl(), "trusted wake URL must be preserved");
    }

    private static void acceptsOnlyServerIsoInstantShape() {
        require(ShortOpApiClient.isStrictIsoInstant("2026-08-23T12:16:58.000Z"), "server ISO timestamp must pass");
        require(!ShortOpApiClient.isStrictIsoInstant("2026-02-30T12:16:58.000Z"), "invalid calendar date must fail");
        require(!ShortOpApiClient.isStrictIsoInstant("2026-08-23T12:16:58Z"), "missing milliseconds must fail");
        require(!ShortOpApiClient.isStrictIsoInstant("2026-08-23 12:16:58.000Z"), "non-ISO separator must fail");
    }

    private static void rejectsUnsafeOrMalformedSuccessResponses() {
        assertInvalidResponse(successJson("123456789").replace("tencent1105602870://", "https://"));
        assertInvalidResponse(successJson("123456789").replace("tencent1105602870://", "tencent9999999999://"));
        assertInvalidResponse(successJson("123456789").replace("\"appId\":\"1105602870\"", "\"appId\":\"9999999999\""));
        assertInvalidResponse(successJson("123456789").replace("open|access|pay", "open|access"));
        assertInvalidResponse(successJson("123456789").replace("\"expiresAt\":\"2026-08-23T12:16:58.000Z\",", ""));
        assertInvalidResponse(successJson("123456789").replace("}", ",\"extra\":\"value\"}"));
    }

    private static void mapsPublicApiAndNetworkFailuresWithoutLeakingResponseData() throws Exception {
        assertFailure(400, ShortOpApiClient.Failure.INVALID);
        assertFailure(404, ShortOpApiClient.Failure.INVALID);
        assertFailure(429, ShortOpApiClient.Failure.RATE_LIMITED);

        ShortOpApiClient timeoutClient = new ShortOpApiClient("https://resolver.example", url -> {
            throw new java.net.SocketTimeoutException("fixture secret response");
        });
        assertFailure(timeoutClient, ShortOpApiClient.Failure.TIMEOUT);

        ShortOpApiClient offlineClient = new ShortOpApiClient("https://resolver.example", url -> {
            throw new IOException("fixture secret response");
        });
        assertFailure(offlineClient, ShortOpApiClient.Failure.OFFLINE);
    }

    private static void rejectsNonHttpsBaseUrls() {
        assertThrows(() -> new ShortOpApiClient("http://resolver.example"), "cleartext bases must be rejected");
        assertThrows(() -> new ShortOpApiClient("https://resolver.example?code=leak"), "query-bearing bases must be rejected");
    }

    private static void suppressesStaleOrDestroyedShortOpCallbacks() {
        ShortOpRequestGate gate = new ShortOpRequestGate();
        int first = gate.begin();
        require(gate.isCurrent(first), "new request must be current");
        int second = gate.begin();
        require(!gate.isCurrent(first), "a repeated submit must suppress the old callback");
        require(gate.isCurrent(second), "the newest submit must remain current");
        gate.destroy();
        require(!gate.isCurrent(second), "destroyed activities must suppress callbacks");
    }

    private static void assertFailure(int status, ShortOpApiClient.Failure expected) throws Exception {
        assertFailure(new ShortOpApiClient("https://resolver.example", url -> new FakeConnection(status, "{\"error\":\"fixture secret response\"}")), expected);
    }

    private static void assertFailure(ShortOpApiClient client, ShortOpApiClient.Failure expected) throws Exception {
        try {
            client.resolve("123456789");
            throw new AssertionError("expected resolver failure " + expected);
        } catch (ShortOpApiClient.ResolveException error) {
            requireEquals(expected, error.failure(), "resolver failure must map to a safe UI state");
            require(!String.valueOf(error.getMessage()).contains("fixture secret response"), "resolver errors must not leak server bodies");
        }
    }

    private static void assertInvalidResponse(String json) {
        try {
            ShortOpApiClient.parse(200, json);
            throw new AssertionError("expected malformed success response to be rejected");
        } catch (ShortOpApiClient.ResolveException error) {
            requireEquals(ShortOpApiClient.Failure.INVALID, error.failure(), "malformed successful responses must be invalid");
        }
    }

    private static void assertThrows(ThrowingRunnable runnable, String message) {
        try {
            runnable.run();
            throw new AssertionError(message);
        } catch (IllegalArgumentException expected) {
            // Expected contract behavior.
        } catch (Exception error) {
            throw new AssertionError(error);
        }
    }

    private static String successJson(String code) {
        return "{\"status\":\"success\",\"code\":\"" + code + "\",\"opData\":\"open|access|pay\","
            + "\"project\":{\"key\":\"douyin\",\"name\":\"抖音\",\"appId\":\"1105602870\"},"
            + "\"expiresAt\":\"2026-08-23T12:16:58.000Z\","
            + "\"wakeUrl\":\"tencent1105602870://qzapp/mqzone/0?objectlocation=url&pasteboard=fixture\"}";
    }

    private interface ThrowingRunnable { void run() throws Exception; }

    private static final class FakeConnection extends HttpURLConnection {
        final int status;
        final String responseBody;
        final Map<String, String> headers = new LinkedHashMap<>();
        final ByteArrayOutputStream request = new ByteArrayOutputStream();
        String requestMethod;
        int connectTimeout;
        int readTimeout;

        FakeConnection(int status, String responseBody) throws IOException {
            super(new URL("https://fixture.invalid/api/op/resolve"));
            this.status = status;
            this.responseBody = responseBody;
        }

        @Override public void setRequestMethod(String method) { requestMethod = method; }
        @Override public void setRequestProperty(String key, String value) { headers.put(key, value); }
        @Override public void setConnectTimeout(int timeout) { connectTimeout = timeout; }
        @Override public void setReadTimeout(int timeout) { readTimeout = timeout; }
        @Override public ByteArrayOutputStream getOutputStream() { return request; }
        @Override public int getResponseCode() { return status; }
        @Override public ByteArrayInputStream getInputStream() { return new ByteArrayInputStream(responseBody.getBytes(StandardCharsets.UTF_8)); }
        @Override public ByteArrayInputStream getErrorStream() { return new ByteArrayInputStream(responseBody.getBytes(StandardCharsets.UTF_8)); }
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() {}
        String requestBody() { return request.toString(StandardCharsets.UTF_8); }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void requireEquals(Object expected, Object actual, String message) {
        if (!expected.equals(actual)) throw new AssertionError(message + ": expected " + expected + ", got " + actual);
    }
}
