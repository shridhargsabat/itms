-- 0007_requests.sql — P0-3 service catalog + request forms (issue #51)
-- Standardized intake forms (new laptop, access, password reset…), dynamic
-- form fields per catalog item, auto-routing to agents, optional single
-- approver step. Turns WhatsApp/corridor asks into structured work.

CREATE TABLE request_catalog_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL DEFAULT 'IT',
    approval_required BOOLEAN NOT NULL DEFAULT FALSE,
    form_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE service_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_number VARCHAR(50) UNIQUE NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES request_catalog_items(id),
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED'
        CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_requests_requester ON service_requests (requester_id, created_at DESC);
CREATE INDEX idx_service_requests_assignee ON service_requests (assignee_id, status);
CREATE INDEX idx_service_requests_status ON service_requests (status, created_at DESC);

-- Seed catalog: the 6 standard request types (small catalog, per issue).
INSERT INTO request_catalog_items (code, name, description, category, approval_required, form_fields, sort_order) VALUES
('NEW_LAPTOP', 'New Laptop Request', 'Request a new laptop for onboarding or replacement.', 'Hardware', TRUE,
 '[{"key":"employee_name","label":"Employee name","type":"text","required":true},{"key":"department","label":"Department","type":"text","required":true},{"key":"model_preference","label":"Model preference","type":"select","required":false,"options":["Standard 14\"","Standard 15\"","MacBook Air","MacBook Pro"]},{"key":"replacement","label":"Replacing an old device?","type":"select","required":false,"options":["Yes — old device collected","No — new joiner"]},{"key":"justification","label":"Justification","type":"textarea","required":true}]'::jsonb, 10),
('SOFTWARE_ACCESS', 'Software Access Request', 'Request access to a software license or tool.', 'Software', TRUE,
 '[{"key":"software","label":"Software / tool","type":"text","required":true},{"key":"reason","label":"Business reason","type":"textarea","required":true},{"key":"duration","label":"How long needed?","type":"select","required":false,"options":["1 month","3 months","6 months","Ongoing"]}]'::jsonb, 20),
('PASSWORD_RESET', 'Password Reset', 'Forgot or locked out of a system password.', 'Accounts', FALSE,
 '[{"key":"system","label":"Which system?","type":"select","required":true,"options":["Email","Windows login","ERP / SAPL","WiFi","Other"]},{"key":"notes","label":"Anything we should know","type":"textarea","required":false}]'::jsonb, 30),
('SYSTEM_ACCESS', 'Access to System X', 'Request access to a shared system, folder or drive.', 'Accounts', TRUE,
 '[{"key":"system_name","label":"System / folder / drive","type":"text","required":true},{"key":"access_level","label":"Access level","type":"select","required":true,"options":["Read only","Read + write","Full admin"]},{"key":"reason","label":"Business reason","type":"textarea","required":true}]'::jsonb, 40),
('PERIPHERAL', 'Monitor / Peripheral Request', 'Request a monitor, keyboard, mouse, dock or other peripheral.', 'Hardware', TRUE,
 '[{"key":"item","label":"What do you need?","type":"select","required":true,"options":["Monitor 24\"","Monitor 27\"","Keyboard + mouse","Docking station","Headset","Other"]},{"key":"reason","label":"Reason","type":"textarea","required":true}]'::jsonb, 50),
('ASSET_REPAIR', 'Asset Repair / Replacement', 'Report a faulty device for repair or replacement.', 'Hardware', FALSE,
 '[{"key":"fault","label":"What is wrong?","type":"textarea","required":true},{"key":"urgent","label":"Urgency","type":"select","required":false,"options":["Can wait","This week","Immediately — blocks work"]}]'::jsonb, 60);
