package com.tencent.mobileqq;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Instrumentation;
import android.content.Intent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Button;
import android.widget.EditText;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class MainActivityInstrumentedTest {

    private static final String FIXTURE_OP =
        "fixture-openid|fixture-access|fixture-pay|fixture-pfkey|1782303418";

    @Test
    public void fullOpAuthorizationShowsSafeConfirmationBeforeReturning() {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        AccessibilityServiceInfo info = instrumentation.getUiAutomation().getServiceInfo();
        info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
        instrumentation.getUiAutomation().setServiceInfo(info);

        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        intent.putExtra("is_auth_request", true);
        intent.putExtra("appid", "1105602870");

        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(intent)) {
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
