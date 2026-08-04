package com.tencent.mobileqq;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

public class OpWakeUrlBuilderTest {
    public static void main(String[] args) throws Exception {
        buildsDouyinWakeUrlWithEveryFullOpFieldInTheBinaryPasteboard();
        acceptsThreeToFiveNonEmptySegments();
        rejectsMalformedOrIncompleteOpSegments();
        rejectsNonNumericAppIds();
        System.out.println("OpWakeUrlBuilder offline contract passed");
    }

    private static void buildsDouyinWakeUrlWithEveryFullOpFieldInTheBinaryPasteboard() throws Exception {
        String url = build("fixture-openid|fixture-access|fixture-pay|fixture-pfkey|1782303418", "1105602870");

        require(url.startsWith("tencent1105602870://qzapp/mqzone/0?objectlocation=url&pasteboard="), "must use the Tencent wake URL protocol");
        String pasteboard = new URI(url).getRawQuery().substring("objectlocation=url&pasteboard=".length());
        byte[] payload = Base64.getDecoder().decode(URLDecoder.decode(pasteboard, StandardCharsets.UTF_8));
        String plist = new String(payload, StandardCharsets.ISO_8859_1);

        require(plist.startsWith("bplist00"), "pasteboard must be a binary plist");
        require(plist.contains("fixture-openid"), "plist must contain openid");
        require(plist.contains("fixture-access"), "plist must contain access_token");
        require(plist.contains("fixture-pay"), "plist must contain pay_token");
        require(plist.contains("fixture-pfkey"), "plist must contain pfkey");
        require(plist.contains("1782303418"), "plist must contain auth_time");
    }

    private static void acceptsThreeToFiveNonEmptySegments() throws Exception {
        require(build("open|access|pay", "1105602870").startsWith("tencent1105602870://"), "three segments must be accepted");
        require(build("open|access|pay|pf", "1105602870").startsWith("tencent1105602870://"), "four segments must be accepted");
        require(build("open|access|pay|pf|1782303418", "1105602870").startsWith("tencent1105602870://"), "five segments must be accepted");
    }

    private static void rejectsMalformedOrIncompleteOpSegments() {
        assertInvalid("bad");
        assertInvalid("open|access");
        assertInvalid("open|access|pay|");
        assertInvalid("open|access||pf");
        assertInvalid("open|access|pay|pf|1782303418|extra");
    }

    private static void rejectsNonNumericAppIds() {
        assertInvalidAppId();
    }

    private static void assertInvalid(String value) {
        try {
            build(value, "1105602870");
            throw new AssertionError("expected invalid OP input to be rejected: " + value);
        } catch (IllegalArgumentException expected) {
            // Expected contract behavior.
        } catch (Exception error) {
            throw new AssertionError(error);
        }
    }

    private static void assertInvalidAppId() {
        try {
            build("open|access|pay", "not-an-app-id");
            throw new AssertionError("expected a nonnumeric AppID to be rejected");
        } catch (IllegalArgumentException expected) {
            // Expected contract behavior.
        } catch (Exception error) {
            throw new AssertionError(error);
        }
    }

    private static String build(String opData, String appId) throws Exception {
        Method method;
        try {
            method = Class.forName("com.tencent.mobileqq.OpWakeUrlBuilder").getMethod("build", String.class, String.class);
        } catch (ClassNotFoundException | NoSuchMethodException error) {
            throw new AssertionError("OpWakeUrlBuilder.build must exist for offline OP authorization: " + error.getClass().getSimpleName(), error);
        }

        try {
            Object value = method.invoke(null, opData, appId);
            require(value != null, "builder must return a wake URL");
            require(value.getClass().equals(String.class), "builder must return a String");
            return (String) value;
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof IllegalArgumentException) throw (IllegalArgumentException) cause;
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            throw new AssertionError(cause);
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
