package com.tencent.mobileqq;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Button;
import android.widget.EditText;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.atomic.AtomicBoolean;

@RunWith(AndroidJUnit4.class)
public final class MainActivityInstrumentedTest {

    private static final String FIXTURE_OP =
        "fixture-openid|fixture-access|fixture-pay|fixture-pfkey|1782303418";

    @Test
    public void blankInputStaysOnScreenAndRestoresSubmitButton() {
        try (ActivityScenario<MainActivity> scenario = launch(false)) {
            scenario.onActivity(activity -> {
                Button submit = activity.findViewById(R.id.submit);
                submit.performClick();
                assertFalse("blank input must not finish activity", activity.isFinishing());
                assertTrue("blank input must leave submit enabled", submit.isEnabled());
            });
        }
    }

    @Test
    public void malformedFullOpStaysOnScreenAndRestoresSubmitButton() {
        try (ActivityScenario<MainActivity> scenario = launch(false)) {
            scenario.onActivity(activity -> {
                EditText input = activity.findViewById(R.id.op_data_input);
                Button submit = activity.findViewById(R.id.submit);
                input.setText("malformed-op");
                submit.performClick();
                assertFalse("invalid OP must not finish activity", activity.isFinishing());
                assertTrue("invalid OP must leave submit enabled", submit.isEnabled());
            });
        }
    }

    @Test
    public void shortOpOfflineFailureRestoresSubmitButton() {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        try (ActivityScenario<MainActivity> scenario = launch(false)) {
            scenario.onActivity(activity -> {
                EditText input = activity.findViewById(R.id.op_data_input);
                Button submit = activity.findViewById(R.id.submit);
                input.setText("123456789");
                submit.performClick();
                assertFalse("short OP request must disable duplicate submit", submit.isEnabled());
            });

            AtomicBoolean enabled = new AtomicBoolean(false);
            long deadline = SystemClock.uptimeMillis() + 5_000L;
            while (!enabled.get() && SystemClock.uptimeMillis() < deadline) {
                instrumentation.waitForIdleSync();
                scenario.onActivity(activity ->
                    enabled.set(activity.<Button>findViewById(R.id.submit).isEnabled()));
                if (!enabled.get()) SystemClock.sleep(50L);
            }
            assertTrue("offline failure must restore submit within five seconds", enabled.get());
        }
    }

    @Test
    public void fullOpAuthorizationShowsSafeConfirmationBeforeReturning() {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        AccessibilityServiceInfo info = instrumentation.getUiAutomation().getServiceInfo();
        info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        instrumentation.getUiAutomation().setServiceInfo(info);

        try (ActivityScenario<MainActivity> scenario = launch(true)) {
            scenario.onActivity(activity -> {
                EditText input = activity.findViewById(R.id.op_data_input);
                Button submit = activity.findViewById(R.id.submit);
                input.setText(FIXTURE_OP);
                submit.performClick();
            });
            instrumentation.waitForIdleSync();

            AccessibilityNodeInfo root =
                instrumentation.getUiAutomation().getRootInActiveWindow();
            assertNotNull("success dialog window must be active", root);
            assertTrue("success title must be visible", containsText(root, "成功"));
            assertTrue("safe authorization summary must be visible", containsText(root, "授权数据已安全处理"));
            assertTrue("confirmation action must be visible", containsText(root, "确定"));
            assertFalse("dialog must not display openid", containsText(root, "fixture-openid"));
            assertFalse("dialog must not display access token", containsText(root, "fixture-access"));
        }
    }

    private static ActivityScenario<MainActivity> launch(boolean authRequest) {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.putExtra("is_auth_request", authRequest);
        intent.putExtra("appid", "1105602870");
        return ActivityScenario.launch(intent);
    }

    private static boolean containsText(AccessibilityNodeInfo node, String expected) {
        CharSequence text = node.getText();
        if (text != null && text.toString().contains(expected)) return true;
        for (int index = 0; index < node.getChildCount(); index += 1) {
            AccessibilityNodeInfo child = node.getChild(index);
            if (child != null && containsText(child, expected)) return true;
        }
        return false;
    }
}
